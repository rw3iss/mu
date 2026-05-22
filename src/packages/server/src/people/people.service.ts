import { nowISO } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies, type NewPerson, type Person, people } from '../database/schema/index.js';
import {
	type TmdbPersonCombinedCredits,
	type TmdbPersonDetails,
	TmdbProvider,
} from '../metadata/providers/tmdb.provider.js';

/**
 * Namespaced person key — the stable identifier used by URLs, cast
 * lists, and favorites. Format:
 *   - `tmdb:287`     when we have a TMDB person id
 *   - `name:brad-pitt`  fallback for name-only people
 *
 * The frontend operates on these strings directly so favorite checks
 * stay O(1) without a server roundtrip per cast row.
 */
export type PersonKey = string;

interface ParsedKey {
	source: 'tmdb' | 'name';
	id: string;
}

export interface PersonView {
	id: string;
	key: PersonKey;
	name: string;
	tmdbId: number | null;
	imdbId: string | null;
	profileUrl: string | null;
	birthday: string | null;
	placeOfBirth: string | null;
	deathday: string | null;
	biography: string | null;
	knownForDepartment: string | null;
	gender: number | null;
	popularity: number | null;
	alsoKnownAs: string[];
	knownForMovies: PersonCreditView[];
}

export interface PersonCreditView {
	tmdbId: number;
	title: string;
	year: number | null;
	posterUrl: string | null;
	character?: string | null;
	job?: string | null;
	department?: string | null;
	mediaType: 'movie' | 'tv';
	movieId?: string | null;
}

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function slugifyName(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export function personKey(opts: { tmdbId?: number | null; name?: string | null }): PersonKey {
	if (opts.tmdbId) return `tmdb:${opts.tmdbId}`;
	if (opts.name) return `name:${slugifyName(opts.name)}`;
	return 'name:unknown';
}

export function parsePersonKey(key: string): ParsedKey | null {
	const idx = key.indexOf(':');
	if (idx < 0) return null;
	const source = key.slice(0, idx);
	const id = key.slice(idx + 1);
	if (source !== 'tmdb' && source !== 'name') return null;
	if (!id) return null;
	return { source, id };
}

@Injectable()
export class PeopleService {
	constructor(
		private readonly database: DatabaseService,
		private readonly tmdb: TmdbProvider,
	) {}

	/**
	 * Resolve a person by their namespaced key. Returns a cached DB
	 * row if fresh, otherwise fetches from TMDB, upserts, and returns.
	 * Returns null when the key references an unknown TMDB id with no
	 * fallback. For `name:` keys without a TMDB match we still
	 * upsert a minimal row so favoriting works.
	 */
	async getOrFetch(key: string): Promise<PersonView | null> {
		const parsed = parsePersonKey(key);
		if (!parsed) return null;

		const existing = this.findByExternalId(key);
		if (existing && !this.isStale(existing)) {
			return this.toView(existing);
		}

		if (parsed.source === 'tmdb') {
			const tmdbId = Number.parseInt(parsed.id, 10);
			if (!Number.isFinite(tmdbId)) return null;
			const upserted = await this.fetchAndUpsertFromTmdb(tmdbId, key);
			return upserted ? this.toView(upserted) : existing ? this.toView(existing) : null;
		}

		// name:<slug> — try to resolve via TMDB search, otherwise minimal row.
		const guess = parsed.id.replace(/-/g, ' ');
		const search = await this.tmdb.searchPerson(guess);
		const top = search?.[0];
		if (top && slugifyName(top.name) === parsed.id) {
			const upserted = await this.fetchAndUpsertFromTmdb(top.id, key);
			if (upserted) return this.toView(upserted);
		}
		// No TMDB match — create / return minimal row.
		return this.toView(this.upsertMinimal({ externalId: key, name: guess }));
	}

	/**
	 * Bulk lookup used by /favorites — given an array of internal
	 * people.id values, returns rows keyed by id.
	 */
	getByIds(ids: string[]): Map<string, Person> {
		const map = new Map<string, Person>();
		if (ids.length === 0) return map;
		const rows = this.database.db.select().from(people).where(inArray(people.id, ids)).all();
		for (const row of rows) map.set(row.id, row);
		return map;
	}

	/**
	 * Resolve a set of person keys (`tmdb:N` / `name:slug`) to **local
	 * movie ids** for credits already in the library. Used by the
	 * Discover endpoint as the canonical bridge between a favorited
	 * person and the recommender's seed input — the recommender only
	 * accepts in-library movie ids, so this hides the people→films
	 * lookup + library cross-ref behind a single call.
	 *
	 * Per-person budget defaults to 4 so a user with many favorite
	 * people doesn't dilute the seed centroid into noise.
	 */
	async resolveOwnedMovieIds(
		keys: string[],
		perPersonLimit: number = 4,
	): Promise<{ movieIds: string[]; unresolvedKeys: string[] }> {
		const movieIds: string[] = [];
		const unresolved: string[] = [];
		const seen = new Set<string>();

		for (const key of keys) {
			const view = await this.getOrFetch(key);
			if (!view || view.knownForMovies.length === 0) {
				unresolved.push(key);
				continue;
			}
			const movieCredits = view.knownForMovies.filter(
				(c) => c.mediaType === 'movie' && c.tmdbId,
			);
			if (movieCredits.length === 0) {
				unresolved.push(key);
				continue;
			}
			const tmdbIds = movieCredits.map((c) => c.tmdbId);
			const owned = this.database.db
				.select({ id: movies.id, tmdbId: movies.tmdbId })
				.from(movies)
				.where(inArray(movies.tmdbId, tmdbIds))
				.all();
			if (owned.length === 0) {
				unresolved.push(key);
				continue;
			}
			const ownedByTmdb = new Map<number, string>();
			for (const o of owned) if (o.tmdbId) ownedByTmdb.set(o.tmdbId, o.id);

			let added = 0;
			for (const c of movieCredits) {
				if (added >= perPersonLimit) break;
				const id = ownedByTmdb.get(c.tmdbId);
				if (id && !seen.has(id)) {
					movieIds.push(id);
					seen.add(id);
					added += 1;
				}
			}
		}
		return { movieIds, unresolvedKeys: unresolved };
	}

	/**
	 * Ensure a person row exists for the given external reference.
	 * Used by Favorites when adding from a cast row — we may have
	 * just the cast member's name + tmdbId, and need a stable
	 * people.id to point the favorite at.
	 */
	async ensureExists(input: {
		tmdbId?: number | null;
		name?: string | null;
		profileUrl?: string | null;
		role?: string | null;
	}): Promise<Person | null> {
		const key = personKey(input);
		const existing = this.findByExternalId(key);
		if (existing) return existing;

		if (input.tmdbId) {
			const upserted = await this.fetchAndUpsertFromTmdb(input.tmdbId, key);
			if (upserted) return upserted;
		}
		if (!input.name) return null;
		return this.upsertMinimal({
			externalId: key,
			name: input.name,
			profileUrl: input.profileUrl ?? null,
			knownForDepartment: input.role ?? null,
		});
	}

	findByExternalId(externalId: string): Person | null {
		return (
			this.database.db.select().from(people).where(eq(people.externalId, externalId)).get() ??
			null
		);
	}

	toView(row: Person): PersonView {
		let knownFor: PersonCreditView[] = [];
		let alsoKnownAs: string[] = [];
		if (row.metadata) {
			try {
				const parsed = JSON.parse(row.metadata);
				if (Array.isArray(parsed?.knownForMovies)) knownFor = parsed.knownForMovies;
				if (Array.isArray(parsed?.alsoKnownAs)) alsoKnownAs = parsed.alsoKnownAs;
			} catch {}
		}
		if (row.alsoKnownAs && alsoKnownAs.length === 0) {
			try {
				alsoKnownAs = JSON.parse(row.alsoKnownAs) ?? [];
			} catch {}
		}
		return {
			id: row.id,
			key: row.externalId,
			name: row.name,
			tmdbId: row.tmdbId,
			imdbId: row.imdbId,
			profileUrl: row.profileUrl,
			birthday: row.birthday,
			placeOfBirth: row.placeOfBirth,
			deathday: row.deathday,
			biography: row.biography,
			knownForDepartment: row.knownForDepartment,
			gender: row.gender,
			popularity: row.popularity,
			alsoKnownAs,
			knownForMovies: knownFor,
		};
	}

	private isStale(row: Person): boolean {
		if (!row.fetchedAt) return true;
		const fetched = Date.parse(row.fetchedAt);
		if (!Number.isFinite(fetched)) return true;
		return Date.now() - fetched > STALE_AFTER_MS;
	}

	private async fetchAndUpsertFromTmdb(
		tmdbId: number,
		externalId?: string,
	): Promise<Person | null> {
		const [details, credits] = await Promise.all([
			this.tmdb.getPersonDetails(tmdbId),
			this.tmdb.getPersonCombinedCredits(tmdbId),
		]);
		if (!details) return null;
		return this.upsertFromTmdb(details, credits, externalId);
	}

	private upsertFromTmdb(
		details: TmdbPersonDetails,
		credits: TmdbPersonCombinedCredits | null,
		externalIdOverride?: string,
	): Person | null {
		const externalId = externalIdOverride ?? `tmdb:${details.id}`;
		const existing = this.findByExternalId(externalId);
		const now = nowISO();

		const knownForMovies = this.deriveKnownFor(credits);
		const metadata: Record<string, unknown> = {
			knownForMovies,
			alsoKnownAs: details.also_known_as ?? [],
		};

		const profileUrl = details.profile_path
			? `${TMDB_IMAGE_BASE}/w500${details.profile_path}`
			: null;

		const values: NewPerson = {
			id: existing?.id ?? crypto.randomUUID(),
			externalId,
			source: 'tmdb',
			tmdbId: details.id,
			imdbId: details.imdb_id ?? details.external_ids?.imdb_id ?? null,
			name: details.name,
			profileUrl,
			birthday: details.birthday ?? null,
			placeOfBirth: details.place_of_birth ?? null,
			deathday: details.deathday ?? null,
			biography: details.biography ?? null,
			knownForDepartment: details.known_for_department ?? null,
			gender: details.gender ?? null,
			popularity: details.popularity ?? null,
			alsoKnownAs: JSON.stringify(details.also_known_as ?? []),
			metadata: JSON.stringify(metadata),
			fetchedAt: now,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};

		if (existing) {
			this.database.db.update(people).set(values).where(eq(people.id, existing.id)).run();
		} else {
			this.database.db.insert(people).values(values).run();
		}
		return this.findByExternalId(externalId);
	}

	private upsertMinimal(input: {
		externalId: string;
		name: string;
		profileUrl?: string | null;
		knownForDepartment?: string | null;
	}): Person {
		const existing = this.findByExternalId(input.externalId);
		const now = nowISO();
		if (existing) return existing;
		const values: NewPerson = {
			id: crypto.randomUUID(),
			externalId: input.externalId,
			source: input.externalId.startsWith('tmdb:') ? 'tmdb' : 'name',
			tmdbId: input.externalId.startsWith('tmdb:')
				? Number.parseInt(input.externalId.slice(5), 10) || null
				: null,
			imdbId: null,
			name: input.name,
			profileUrl: input.profileUrl ?? null,
			birthday: null,
			placeOfBirth: null,
			deathday: null,
			biography: null,
			knownForDepartment: input.knownForDepartment ?? null,
			gender: null,
			popularity: null,
			alsoKnownAs: null,
			metadata: null,
			fetchedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		this.database.db.insert(people).values(values).run();
		return this.findByExternalId(input.externalId)!;
	}

	private deriveKnownFor(credits: TmdbPersonCombinedCredits | null): PersonCreditView[] {
		if (!credits) return [];
		const all: PersonCreditView[] = [];
		for (const c of credits.cast ?? []) {
			if (!c.id) continue;
			all.push({
				tmdbId: c.id,
				title: c.title ?? c.name ?? 'Untitled',
				year: c.release_date
					? Number.parseInt(c.release_date.slice(0, 4), 10) || null
					: null,
				posterUrl: c.poster_path ? `${TMDB_IMAGE_BASE}/w342${c.poster_path}` : null,
				character: c.character ?? null,
				mediaType: c.media_type,
			});
		}
		for (const c of credits.crew ?? []) {
			if (!c.id) continue;
			// Dedupe: prefer existing cast credit for same tmdbId.
			if (all.some((x) => x.tmdbId === c.id && x.mediaType === c.media_type)) continue;
			all.push({
				tmdbId: c.id,
				title: c.title ?? c.name ?? 'Untitled',
				year: c.release_date
					? Number.parseInt(c.release_date.slice(0, 4), 10) || null
					: null,
				posterUrl: c.poster_path ? `${TMDB_IMAGE_BASE}/w342${c.poster_path}` : null,
				job: c.job ?? null,
				department: c.department ?? null,
				mediaType: c.media_type,
			});
		}
		// Sort by popularity-ish proxy: year desc, then job/cast prominence.
		all.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
		return all.slice(0, 24);
	}

	/**
	 * Federated-search helper: returns library people hits normalized
	 * to the PersonSearchHit shape used by FederatedPeopleSearchService.
	 */
	async searchPeopleForFederation(query: string): Promise<
		Array<{
			personKey: string;
			tmdbId?: number;
			name: string;
			profileUrl?: string;
			role?: string;
			sources: Array<'local'>;
			isOwned: boolean;
			matchScore: number;
		}>
	> {
		const q = `%${query.toLowerCase()}%`;
		const rows = this.database.db
			.select({
				externalId: people.externalId,
				tmdbId: people.tmdbId,
				name: people.name,
				profileUrl: people.profileUrl,
				knownForDepartment: people.knownForDepartment,
			})
			.from(people)
			.where(sql`lower(${people.name}) like ${q}`)
			.limit(25)
			.all();
		return rows.map((r) => ({
			personKey: r.externalId,
			tmdbId: r.tmdbId ?? undefined,
			name: r.name,
			profileUrl: r.profileUrl ?? undefined,
			role: r.knownForDepartment ?? undefined,
			sources: ['local'] as Array<'local'>,
			isOwned: true,
			matchScore: 0,
		}));
	}
}

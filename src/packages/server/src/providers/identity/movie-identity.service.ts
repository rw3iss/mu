import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { movieIdentities, movies } from '../../database/schema/index.js';

/**
 * Multi-source identity registry for movies.
 *
 * Owns the movie_identities table. Lets any provider record that an
 * external id (`tmdb:603`, `imdb:tt0133093`, `trakt:the-matrix-1999`,
 * `wikidata:Q83495`) belongs to a local movie row.
 *
 * Why this exists:
 *   - Pre-Phase-0 we stored external ids as flat columns on `movies`
 *     (tmdbId, imdbId). Adding a third source needed a migration.
 *   - With this registry, adding a source is just inserting rows.
 *   - Cross-source resolution becomes O(1): "given this Trakt slug,
 *     do we already have this movie?" → one indexed lookup.
 *
 * Behavior:
 *   - link() is idempotent — calling twice with the same triple is
 *     a no-op (UNIQUE (source, externalId)).
 *   - When a new identity is linked to a movieId, the registry also
 *     back-fills the legacy flat columns on `movies` (tmdbId/imdbId)
 *     so existing query paths keep working without changes.
 *
 * SOLID:
 *   - SRP: only manages identity rows. No metadata, no payloads.
 *   - DIP: depends on DatabaseService interface, not the underlying
 *     sqlite driver.
 */
@Injectable()
export class MovieIdentityService {
	constructor(private readonly database: DatabaseService) {}

	/**
	 * Link an external ID to a local movie. Returns the row that was
	 * inserted, or the existing row if the (source, externalId) pair
	 * was already linked. If linking a NEW pair causes the legacy
	 * `movies.tmdbId` / `movies.imdbId` columns to gain a value, we
	 * write those too so existing call sites that grep those columns
	 * still find the movie.
	 */
	async link(args: {
		movieId: string;
		source: string;
		externalId: string | number;
		confidence?: number;
	}): Promise<{ id: string; created: boolean }> {
		const externalIdStr = String(args.externalId);
		const now = new Date().toISOString();
		const db = this.database.db;

		const existing = db
			.select({ id: movieIdentities.id, movieId: movieIdentities.movieId })
			.from(movieIdentities)
			.where(
				and(
					eq(movieIdentities.source, args.source),
					eq(movieIdentities.externalId, externalIdStr),
				),
			)
			.get();

		if (existing) {
			// Already linked. If somehow it points to a different movie,
			// we DON'T silently overwrite — that's a data-integrity bug
			// the matcher needs to resolve (see Risk R-3 in the plan).
			if (existing.movieId && existing.movieId !== args.movieId) {
				return { id: existing.id, created: false };
			}
			// Same target (or previously unmatched) — update timestamps.
			db.update(movieIdentities)
				.set({ updatedAt: now, movieId: args.movieId, confidence: args.confidence ?? 1.0 })
				.where(eq(movieIdentities.id, existing.id))
				.run();
			this.syncLegacyColumns(args.movieId, args.source, externalIdStr);
			return { id: existing.id, created: false };
		}

		const id = randomUUID();
		db.insert(movieIdentities)
			.values({
				id,
				movieId: args.movieId,
				source: args.source,
				externalId: externalIdStr,
				confidence: args.confidence ?? 1.0,
				addedAt: now,
				updatedAt: now,
			})
			.run();
		this.syncLegacyColumns(args.movieId, args.source, externalIdStr);
		return { id, created: true };
	}

	/**
	 * Resolve an external ID to a local movieId. Returns null if we
	 * have not seen this (source, externalId) pair before.
	 */
	async resolve(source: string, externalId: string | number): Promise<string | null> {
		const row = this.database.db
			.select({ movieId: movieIdentities.movieId })
			.from(movieIdentities)
			.where(
				and(eq(movieIdentities.source, source), eq(movieIdentities.externalId, String(externalId))),
			)
			.get();
		return row?.movieId ?? null;
	}

	/** All identities recorded for a movie, indexed by source. */
	async listFor(movieId: string): Promise<Record<string, string>> {
		const rows = this.database.db
			.select({ source: movieIdentities.source, externalId: movieIdentities.externalId })
			.from(movieIdentities)
			.where(eq(movieIdentities.movieId, movieId))
			.all();
		const out: Record<string, string> = {};
		for (const r of rows) out[r.source] = r.externalId;
		return out;
	}

	/**
	 * Bulk reverse-lookup: given many external ids in the same source,
	 * return a Map<externalId, movieId>. Useful for the matcher when
	 * a Searcher returns N hits and we want to know which ones we
	 * already have.
	 */
	async resolveBatch(
		source: string,
		externalIds: (string | number)[],
	): Promise<Map<string, string>> {
		const ids = externalIds.map((x) => String(x));
		if (ids.length === 0) return new Map();
		const rows = this.database.db
			.select({ externalId: movieIdentities.externalId, movieId: movieIdentities.movieId })
			.from(movieIdentities)
			.where(and(eq(movieIdentities.source, source), inArray(movieIdentities.externalId, ids)))
			.all();
		const out = new Map<string, string>();
		for (const r of rows) {
			if (r.movieId) out.set(r.externalId, r.movieId);
		}
		return out;
	}

	/**
	 * Adopt all known identities from a TMDB external_ids payload (or
	 * any equivalent map). Convenience used by the metadata pipeline
	 * to record imdb / facebook / instagram / etc in one call.
	 */
	async linkMany(args: {
		movieId: string;
		identities: { source: string; externalId: string | number; confidence?: number }[];
	}): Promise<void> {
		for (const i of args.identities) {
			if (!i.externalId) continue;
			await this.link({ movieId: args.movieId, ...i });
		}
	}

	/**
	 * Mirror the link into the legacy hot columns on the `movies` table
	 * so the rest of the system (which still reads movies.tmdbId /
	 * movies.imdbId directly) sees the new identity without changes.
	 */
	private syncLegacyColumns(movieId: string, source: string, externalId: string): void {
		const db = this.database.db;
		if (source === 'tmdb') {
			const n = Number(externalId);
			if (Number.isFinite(n)) {
				db.update(movies).set({ tmdbId: n }).where(eq(movies.id, movieId)).run();
			}
		} else if (source === 'imdb') {
			db.update(movies).set({ imdbId: externalId }).where(eq(movies.id, movieId)).run();
		}
	}
}

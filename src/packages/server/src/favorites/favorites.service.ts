import { nowISO } from '@mu/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { favorites, movies, people } from '../database/schema/index.js';
import { PeopleService, personKey } from '../people/people.service.js';

export type FavoriteEntityType = 'person' | 'movie';

export interface AddFavoriteInput {
	entityType: FavoriteEntityType;
	role?: string | null;
	// Person identifiers (one or both):
	tmdbId?: number | null;
	imdbId?: string | null;
	name?: string | null;
	profileUrl?: string | null;
	// Movie identifier:
	movieId?: string | null;
}

export interface RemoveFavoriteInput {
	entityType: FavoriteEntityType;
	entityId?: string | null;
	// Convenience identifiers — resolved server-side if entityId not provided.
	tmdbId?: number | null;
	name?: string | null;
	movieId?: string | null;
}

export interface FavoriteKeysResponse {
	personKeys: string[];
	movieIds: string[];
}

export interface FavoriteView {
	id: string;
	entityType: FavoriteEntityType;
	entityId: string;
	key: string;
	role: string | null;
	createdAt: string;
	person?: {
		id: string;
		name: string;
		profileUrl: string | null;
		knownForDepartment: string | null;
		tmdbId: number | null;
		popularity: number | null;
		birthday: string | null;
	};
	movie?: {
		id: string;
		title: string;
		year: number | null;
		posterUrl: string | null;
		overview: string | null;
		tmdbId: number | null;
		runtimeMinutes: number | null;
	};
}

interface CacheEntry {
	personKeys: Set<string>;
	movieIds: Set<string>;
}

@Injectable()
export class FavoritesService {
	private readonly keyCache = new Map<string, CacheEntry>();

	constructor(
		private readonly database: DatabaseService,
		private readonly peopleSvc: PeopleService,
	) {}

	listKeys(userId: string): FavoriteKeysResponse {
		const cached = this.keyCache.get(userId);
		if (cached) {
			return {
				personKeys: [...cached.personKeys],
				movieIds: [...cached.movieIds],
			};
		}
		// People → externalId is the key. Movies → entityId IS the id.
		const personRows = this.database.db
			.select({ externalId: people.externalId })
			.from(favorites)
			.innerJoin(people, eq(people.id, favorites.entityId))
			.where(and(eq(favorites.userId, userId), eq(favorites.entityType, 'person')))
			.all();
		const movieRows = this.database.db
			.select({ id: favorites.entityId })
			.from(favorites)
			.where(and(eq(favorites.userId, userId), eq(favorites.entityType, 'movie')))
			.all();

		const personKeys = new Set(personRows.map((r) => r.externalId));
		const movieIds = new Set(movieRows.map((r) => r.id));
		this.keyCache.set(userId, { personKeys, movieIds });
		return { personKeys: [...personKeys], movieIds: [...movieIds] };
	}

	async list(userId: string): Promise<FavoriteView[]> {
		const rows = this.database.db
			.select()
			.from(favorites)
			.where(eq(favorites.userId, userId))
			.orderBy(desc(favorites.createdAt))
			.all();
		if (rows.length === 0) return [];

		const personIds = rows.filter((r) => r.entityType === 'person').map((r) => r.entityId);
		const movieIds = rows.filter((r) => r.entityType === 'movie').map((r) => r.entityId);

		const personMap =
			personIds.length > 0
				? new Map(
						this.database.db
							.select()
							.from(people)
							.where(inArray(people.id, personIds))
							.all()
							.map((p) => [p.id, p]),
					)
				: new Map();
		const movieMap =
			movieIds.length > 0
				? new Map(
						this.database.db
							.select()
							.from(movies)
							.where(inArray(movies.id, movieIds))
							.all()
							.map((m) => [m.id, m]),
					)
				: new Map();

		const out: FavoriteView[] = [];
		for (const r of rows) {
			if (r.entityType === 'person') {
				const p = personMap.get(r.entityId);
				if (!p) continue; // orphan — skip silently
				out.push({
					id: r.id,
					entityType: 'person',
					entityId: r.entityId,
					key: p.externalId,
					role: r.role,
					createdAt: r.createdAt,
					person: {
						id: p.id,
						name: p.name,
						profileUrl: p.profileUrl,
						knownForDepartment: p.knownForDepartment,
						tmdbId: p.tmdbId,
						popularity: p.popularity,
						birthday: p.birthday,
					},
				});
			} else if (r.entityType === 'movie') {
				const m = movieMap.get(r.entityId);
				if (!m) continue;
				out.push({
					id: r.id,
					entityType: 'movie',
					entityId: r.entityId,
					key: r.entityId,
					role: r.role,
					createdAt: r.createdAt,
					movie: {
						id: m.id,
						title: m.title,
						year: m.year,
						posterUrl: m.posterUrl,
						overview: m.overview,
						tmdbId: m.tmdbId,
						runtimeMinutes: m.runtimeMinutes,
					},
				});
			}
		}
		return out;
	}

	async add(userId: string, input: AddFavoriteInput): Promise<FavoriteView> {
		const entityId = await this.resolveEntityId(input);
		if (!entityId) {
			throw new NotFoundException('Entity not found');
		}
		const now = nowISO();
		try {
			this.database.db
				.insert(favorites)
				.values({
					id: crypto.randomUUID(),
					userId,
					entityType: input.entityType,
					entityId,
					role: input.role ?? null,
					createdAt: now,
				})
				.run();
		} catch (err: any) {
			if (!/UNIQUE/i.test(err?.message ?? '')) throw err;
		}
		this.bustCache(userId);
		const row = this.database.db
			.select()
			.from(favorites)
			.where(
				and(
					eq(favorites.userId, userId),
					eq(favorites.entityType, input.entityType),
					eq(favorites.entityId, entityId),
				),
			)
			.get();
		const all = await this.list(userId);
		const found = all.find((f) => f.id === row?.id);
		if (!found) throw new NotFoundException('Favorite not retrievable');
		return found;
	}

	async remove(userId: string, input: RemoveFavoriteInput): Promise<boolean> {
		let entityId = input.entityId ?? null;
		if (!entityId) {
			if (input.entityType === 'person') {
				const key = personKey({ tmdbId: input.tmdbId, name: input.name });
				const row = this.peopleSvc.findByExternalId(key);
				entityId = row?.id ?? null;
			} else if (input.entityType === 'movie') {
				entityId = input.movieId ?? null;
			}
		}
		if (!entityId) return false;
		const result = this.database.db
			.delete(favorites)
			.where(
				and(
					eq(favorites.userId, userId),
					eq(favorites.entityType, input.entityType),
					eq(favorites.entityId, entityId),
				),
			)
			.run();
		if (result.changes > 0) this.bustCache(userId);
		return result.changes > 0;
	}

	isFavorited(userId: string, entityType: FavoriteEntityType, key: string): boolean {
		const cached = this.keyCache.get(userId) ?? this.hydrate(userId);
		return entityType === 'person' ? cached.personKeys.has(key) : cached.movieIds.has(key);
	}

	private hydrate(userId: string): CacheEntry {
		this.listKeys(userId);
		return this.keyCache.get(userId)!;
	}

	private bustCache(userId: string): void {
		this.keyCache.delete(userId);
	}

	private async resolveEntityId(input: AddFavoriteInput): Promise<string | null> {
		if (input.entityType === 'movie') {
			if (!input.movieId) return null;
			const exists = this.database.db
				.select({ id: movies.id })
				.from(movies)
				.where(eq(movies.id, input.movieId))
				.get();
			return exists?.id ?? null;
		}
		// person — ensure people row exists, return its internal id.
		const row = await this.peopleSvc.ensureExists({
			tmdbId: input.tmdbId,
			name: input.name,
			profileUrl: input.profileUrl,
			role: input.role,
		});
		return row?.id ?? null;
	}
}

import { type EntityRef, type MediaKind, nowISO } from '@mu/shared';
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies, playlistItems, playlists, users } from '../database/schema/index.js';
import { EntityResolverRegistry } from '../entities/entity-resolver.registry.js';

interface PlaylistMovieSummary {
	movieId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	thumbnailUrl: string | null;
	runtimeMinutes: number | null;
	durationSeconds: number | null;
	addedAt: string | null;
	isRemote?: boolean;
}

/** The entity type each playlist kind holds. */
const ITEM_TYPE: Record<MediaKind, 'movie' | 'track'> = { video: 'movie', audio: 'track' };

@Injectable()
export class PlaylistsService {
	constructor(
		private readonly database: DatabaseService,
		private readonly resolvers: EntityResolverRegistry,
	) {}

	/**
	 * Short-lived list cache (per-user lists + the shared public list).
	 * Busted on ANY playlist mutation by any user — playlists are small,
	 * so a full clear is simpler and always correct.
	 */
	private readonly listCache = new Map<string, { data: any; expires: number }>();
	private static readonly CACHE_TTL_MS = 60_000;

	private cacheGet(key: string) {
		const hit = this.listCache.get(key);
		return hit && hit.expires > Date.now() ? hit.data : null;
	}

	private cacheSet(key: string, data: any) {
		this.listCache.set(key, { data, expires: Date.now() + PlaylistsService.CACHE_TTL_MS });
	}

	bustCache(): void {
		this.listCache.clear();
	}

	/** Owner check OR public-edit contribution rights (add movies). */
	private assertCanContribute(id: string, userId: string) {
		const row = this.database.db
			.select({
				userId: playlists.userId,
				isPublic: playlists.isPublic,
				publicEdit: playlists.publicEdit,
			})
			.from(playlists)
			.where(eq(playlists.id, id))
			.get();
		if (!row) throw new NotFoundException(`Playlist ${id} not found`);
		if (row.userId === userId) return;
		if (row.isPublic && row.publicEdit) return;
		throw new ForbiddenException('This playlist does not accept contributions');
	}

	/** Throws unless `userId` owns the playlist. Mutations only — public
	 *  playlists are strictly read-only for everyone but the author. */
	private assertOwner(id: string, userId: string) {
		const row = this.database.db
			.select({ userId: playlists.userId })
			.from(playlists)
			.where(eq(playlists.id, id))
			.get();
		if (!row) throw new NotFoundException(`Playlist ${id} not found`);
		if (row.userId !== userId) {
			throw new ForbiddenException('Only the playlist owner can modify it');
		}
	}

	create(
		userId: string,
		name: string,
		description?: string,
		opts?: { isPublic?: boolean; publicEdit?: boolean; kind?: MediaKind },
	) {
		const id = crypto.randomUUID();
		const now = nowISO();
		// Public Edit implies Public View.
		const publicEdit = !!opts?.publicEdit;
		const isPublic = publicEdit || !!opts?.isPublic;

		this.database.db
			.insert(playlists)
			.values({
				id,
				userId,
				name,
				description: description ?? null,
				isPublic,
				publicEdit,
				kind: opts?.kind === 'audio' ? 'audio' : 'video',
				createdAt: now,
				updatedAt: now,
			})
			.run();

		this.bustCache();
		return this.findById(id);
	}

	findAll(
		userId: string,
		options?: {
			includeMovies?: boolean;
			sortBy?: 'created' | 'updated' | 'name' | 'movieCount' | 'lastPlayed';
			sortOrder?: 'asc' | 'desc';
			kind?: MediaKind;
		},
	) {
		const kind = options?.kind ?? 'video';
		// "Last played" ranks by movie history; audio playlists fall back to updated.
		const sortBy =
			kind === 'audio' && options?.sortBy === 'lastPlayed'
				? 'updated'
				: (options?.sortBy ?? 'updated');
		const order = options?.sortOrder ?? 'desc';
		const cacheKey = `own:${userId}:${kind}:${sortBy}:${order}:${!!options?.includeMovies}`;
		const cached = this.cacheGet(cacheKey);
		if (cached) return cached;
		const dirFn = order === 'asc' ? asc : desc;

		// For "lastPlayed" sorting we need a subquery-based approach
		if (sortBy === 'lastPlayed') {
			return this.findAllSortedByLastPlayed(userId, options?.includeMovies, order);
		}

		const orderExpr = (() => {
			switch (sortBy) {
				case 'created':
					return dirFn(playlists.createdAt);
				case 'name':
					return dirFn(playlists.name);
				case 'movieCount':
					return dirFn(count(playlistItems.id));
				default:
					return dirFn(playlists.updatedAt);
			}
		})();

		const result = this.database.db
			.select({
				id: playlists.id,
				name: playlists.name,
				description: playlists.description,
				coverUrl: playlists.coverUrl,
				isSmart: playlists.isSmart,
				isPublic: playlists.isPublic,
				publicEdit: playlists.publicEdit,
				userId: playlists.userId,
				createdAt: playlists.createdAt,
				updatedAt: playlists.updatedAt,
				kind: playlists.kind,
				movieCount: count(playlistItems.id),
				itemCount: count(playlistItems.id),
			})
			.from(playlists)
			.leftJoin(
				playlistItems,
				and(
					eq(playlists.id, playlistItems.playlistId),
					eq(playlistItems.itemType, ITEM_TYPE[kind]),
				),
			)
			.where(and(eq(playlists.userId, userId), eq(playlists.kind, kind)))
			.groupBy(playlists.id)
			.orderBy(orderExpr)
			.all();

		if (!options?.includeMovies || kind !== 'video') {
			this.cacheSet(cacheKey, result);
			return result;
		}

		const withMovies = this.attachMovieSummaries(result);
		this.cacheSet(cacheKey, withMovies);
		return withMovies;
	}

	/**
	 * Public playlists from every user, owner username attached. Read-only
	 * surface — viewable by anyone, editable by nobody but the author.
	 */
	findPublic(options?: { includeMovies?: boolean; kind?: MediaKind }) {
		const kind = options?.kind ?? 'video';
		const cacheKey = `public:${kind}:${!!options?.includeMovies}`;
		const cached = this.cacheGet(cacheKey);
		if (cached) return cached;

		const result = this.database.db
			.select({
				id: playlists.id,
				name: playlists.name,
				description: playlists.description,
				coverUrl: playlists.coverUrl,
				isSmart: playlists.isSmart,
				isPublic: playlists.isPublic,
				publicEdit: playlists.publicEdit,
				userId: playlists.userId,
				ownerName: sql<string>`COALESCE(${users.displayName}, ${users.username})`,
				createdAt: playlists.createdAt,
				updatedAt: playlists.updatedAt,
				kind: playlists.kind,
				movieCount: count(playlistItems.id),
				itemCount: count(playlistItems.id),
			})
			.from(playlists)
			.leftJoin(
				playlistItems,
				and(
					eq(playlists.id, playlistItems.playlistId),
					eq(playlistItems.itemType, ITEM_TYPE[kind]),
				),
			)
			.leftJoin(users, eq(playlists.userId, users.id))
			.where(and(eq(playlists.isPublic, true), eq(playlists.kind, kind)))
			.groupBy(playlists.id)
			.orderBy(desc(playlists.updatedAt))
			.all();

		const final =
			options?.includeMovies && kind === 'video' ? this.attachMovieSummaries(result) : result;
		this.cacheSet(cacheKey, final);
		return final;
	}

	/**
	 * Sort playlists by "last played": rank each playlist by how many of its movies
	 * were recently played. Uses the most recent watchedAt per movie, then counts
	 * how many of each playlist's movies appear among the user's recently watched.
	 * Ties broken by playlist updatedAt.
	 */
	private findAllSortedByLastPlayed(
		userId: string,
		includeMovies?: boolean,
		order: 'asc' | 'desc' = 'desc',
	) {
		const dir = order === 'asc' ? 'ASC' : 'DESC';
		const result = this.database.db.all<{
			id: string;
			name: string;
			description: string | null;
			cover_url: string | null;
			is_smart: number | null;
			created_at: string;
			updated_at: string;
			movie_count: number;
			last_played_score: number | null;
		}>(sql`
      SELECT
        p.id,
        p.name,
        p.description,
        p.cover_url,
        p.is_smart,
        p.created_at,
        p.updated_at,
        COALESCE(mc.cnt, 0) AS movie_count,
        lp.score AS last_played_score
      FROM playlists p
      LEFT JOIN (
        SELECT playlist_id, COUNT(*) AS cnt
        FROM playlist_items
        WHERE item_type = 'movie'
        GROUP BY playlist_id
      ) mc ON mc.playlist_id = p.id
      LEFT JOIN (
        SELECT
          pm.playlist_id,
          SUM(CASE WHEN lwh.max_watched IS NOT NULL THEN 1 ELSE 0 END) AS score
        FROM playlist_items pm
        LEFT JOIN (
          SELECT entity_id, MAX(last_played_at) AS max_watched
          FROM play_history
          WHERE user_id = ${userId} AND entity_type = 'movie'
          GROUP BY entity_id
        ) lwh ON lwh.entity_id = pm.item_id
        WHERE pm.item_type = 'movie'
        GROUP BY pm.playlist_id
      ) lp ON lp.playlist_id = p.id
      WHERE p.user_id = ${userId} AND p.kind = 'video'
      ORDER BY COALESCE(lp.score, 0) ${sql.raw(dir)}, p.updated_at ${sql.raw(dir)}
    `);

		const mapped = result.map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			coverUrl: r.cover_url,
			isSmart: !!r.is_smart,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			movieCount: r.movie_count,
		}));

		if (!includeMovies) {
			return mapped;
		}

		return this.attachMovieSummaries(mapped);
	}

	private attachMovieSummaries<T extends { id: string }>(playlists_list: T[]) {
		return playlists_list.map((playlist) => {
			const rows = this.database.db
				.select({
					movieId: playlistItems.itemId,
					title: movies.title,
					year: movies.year,
					posterUrl: movies.posterUrl,
					thumbnailUrl: movies.thumbnailUrl,
					runtimeMinutes: movies.runtimeMinutes,
					durationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
					addedAt: playlistItems.addedAt,
					remoteTitle: playlistItems.remoteTitle,
					remotePosterUrl: playlistItems.remotePosterUrl,
					remoteServerId: playlistItems.remoteServerId,
				})
				.from(playlistItems)
				.leftJoin(
					movies,
					and(eq(playlistItems.itemId, movies.id), eq(playlistItems.itemType, 'movie')),
				)
				.where(eq(playlistItems.playlistId, playlist.id))
				.orderBy(asc(playlistItems.position))
				.all();

			const movieSummaries = rows.map((r) => ({
				movieId: r.movieId,
				title: r.title ?? r.remoteTitle ?? 'Unknown',
				year: r.year,
				posterUrl: r.posterUrl ?? r.remotePosterUrl,
				thumbnailUrl: r.thumbnailUrl,
				runtimeMinutes: r.runtimeMinutes,
				durationSeconds: r.durationSeconds,
				addedAt: r.addedAt,
				isRemote: !!r.remoteServerId,
			})) as PlaylistMovieSummary[];

			return { ...playlist, movies: movieSummaries };
		});
	}

	findById(id: string) {
		const playlist = this.database.db
			.select()
			.from(playlists)
			.where(eq(playlists.id, id))
			.get();

		if (!playlist) {
			throw new NotFoundException(`Playlist ${id} not found`);
		}

		const owner = this.database.db
			.select({ name: sql<string>`COALESCE(${users.displayName}, ${users.username})` })
			.from(users)
			.where(eq(users.id, playlist.userId))
			.get();

		const rows = this.database.db
			.select({
				id: playlistItems.id,
				movieId: playlistItems.itemId,
				position: playlistItems.position,
				addedAt: playlistItems.addedAt,
				movieTitle: movies.title,
				movieYear: movies.year,
				moviePosterUrl: movies.posterUrl,
				movieThumbnailUrl: movies.thumbnailUrl,
				movieRuntimeMinutes: movies.runtimeMinutes,
				remoteTitle: playlistItems.remoteTitle,
				remotePosterUrl: playlistItems.remotePosterUrl,
				remoteServerId: playlistItems.remoteServerId,
			})
			.from(playlistItems)
			.leftJoin(
				movies,
				and(eq(playlistItems.itemId, movies.id), eq(playlistItems.itemType, 'movie')),
			)
			.where(eq(playlistItems.playlistId, id))
			.orderBy(asc(playlistItems.position))
			.all();

		const items = rows.map((r) => ({
			...r,
			movieTitle: r.movieTitle ?? r.remoteTitle ?? 'Unknown',
			moviePosterUrl: r.moviePosterUrl ?? r.remotePosterUrl,
			isRemote: !!r.remoteServerId,
		}));

		if (playlist.kind === 'audio') {
			return {
				...playlist,
				ownerName: owner?.name ?? null,
				movies: [],
				tracks: this.trackItems(id),
			};
		}
		return { ...playlist, ownerName: owner?.name ?? null, movies: items };
	}

	update(
		id: string,
		userId: string,
		data: Partial<{
			name: string;
			description: string;
			coverUrl: string;
			isPublic: boolean;
			publicEdit: boolean;
		}>,
	) {
		this.assertOwner(id, userId);

		this.database.db
			.update(playlists)
			.set({ ...data, updatedAt: nowISO() })
			.where(eq(playlists.id, id))
			.run();

		this.bustCache();
		return this.findById(id);
	}

	remove(id: string, userId: string) {
		this.assertOwner(id, userId);
		this.database.db.delete(playlists).where(eq(playlists.id, id)).run();
		this.bustCache();
	}

	addMovie(
		playlistId: string,
		movieId: string,
		remoteInfo?: { title: string; posterUrl?: string; serverId: string },
		userId?: string,
	) {
		this.insertItem(playlistId, { type: 'movie', id: movieId }, remoteInfo, userId);
	}

	removeMovie(playlistId: string, movieId: string, userId?: string) {
		this.removeItem(playlistId, { type: 'movie', id: movieId }, userId);
	}

	/**
	 * Add any entity to a playlist. The item type must match the playlist's
	 * kind (movies → video, tracks → audio) and the entity must exist.
	 */
	async addItem(playlistId: string, ref: EntityRef, userId: string) {
		const pl = this.database.db
			.select({ kind: playlists.kind })
			.from(playlists)
			.where(eq(playlists.id, playlistId))
			.get();
		if (!pl) throw new NotFoundException(`Playlist ${playlistId} not found`);
		if (ITEM_TYPE[pl.kind as MediaKind] !== ref.type) {
			throw new BadRequestException(`This ${pl.kind} playlist cannot hold a ${ref.type}`);
		}
		await this.resolvers.require(ref.type, ref.id);
		this.insertItem(playlistId, ref, undefined, userId);
	}

	private insertItem(
		playlistId: string,
		ref: EntityRef,
		remoteInfo?: { title: string; posterUrl?: string; serverId: string },
		userId?: string,
	) {
		if (userId) this.assertCanContribute(playlistId, userId);
		this.bustCache();
		const existing = this.database.db
			.select()
			.from(playlistItems)
			.where(
				and(
					eq(playlistItems.playlistId, playlistId),
					eq(playlistItems.itemType, ref.type),
					eq(playlistItems.itemId, ref.id),
				),
			)
			.get();

		if (existing) {
			throw new ConflictException(
				`${ref.type === 'movie' ? 'Movie' : 'Item'} is already in this playlist`,
			);
		}

		// Get the next position
		const maxPos = this.database.db
			.select({ maxPosition: sql<number>`COALESCE(MAX(${playlistItems.position}), 0)` })
			.from(playlistItems)
			.where(eq(playlistItems.playlistId, playlistId))
			.get();

		const position = (maxPos?.maxPosition ?? 0) + 1;

		this.database.db
			.insert(playlistItems)
			.values({
				id: crypto.randomUUID(),
				playlistId,
				itemType: ref.type,
				itemId: ref.id,
				position,
				addedAt: nowISO(),
				addedBy: userId ?? null,
				remoteTitle: remoteInfo?.title ?? null,
				remotePosterUrl: remoteInfo?.posterUrl ?? null,
				remoteServerId: remoteInfo?.serverId ?? null,
			})
			.run();

		// Update playlist timestamp
		this.database.db
			.update(playlists)
			.set({ updatedAt: nowISO() })
			.where(eq(playlists.id, playlistId))
			.run();
	}

	removeItem(playlistId: string, ref: EntityRef, userId?: string) {
		const match = and(
			eq(playlistItems.playlistId, playlistId),
			eq(playlistItems.itemType, ref.type),
			eq(playlistItems.itemId, ref.id),
		);
		if (userId) {
			const pl = this.database.db
				.select({ userId: playlists.userId })
				.from(playlists)
				.where(eq(playlists.id, playlistId))
				.get();
			if (!pl) throw new NotFoundException(`Playlist ${playlistId} not found`);
			if (pl.userId !== userId) {
				// Public-edit contributors may only remove rows they added.
				const row = this.database.db
					.select({ addedBy: playlistItems.addedBy })
					.from(playlistItems)
					.where(match)
					.get();
				if (!row || row.addedBy !== userId) {
					throw new ForbiddenException('You can only remove items you added');
				}
			}
		}
		this.bustCache();
		this.database.db.delete(playlistItems).where(match).run();

		this.database.db
			.update(playlists)
			.set({ updatedAt: nowISO() })
			.where(eq(playlists.id, playlistId))
			.run();
	}

	/** Track rows of an audio playlist, in order, with album + art for display. */
	private trackItems(playlistId: string) {
		return this.database.db
			.all<{
				itemId: string;
				position: number;
				addedAt: string;
				title: string | null;
				artistCredit: string | null;
				albumId: string | null;
				albumTitle: string | null;
				artId: string | null;
				durationSeconds: number | null;
			}>(sql`
			SELECT pi.item_id AS itemId, pi.position, pi.added_at AS addedAt, t.title,
				t.artist_credit AS artistCredit, t.album_id AS albumId, al.title AS albumTitle,
				al.art_id AS artId, t.duration_seconds AS durationSeconds
			FROM playlist_items pi
			LEFT JOIN tracks t ON t.id = pi.item_id
			LEFT JOIN albums al ON al.id = t.album_id
			WHERE pi.playlist_id = ${playlistId} AND pi.item_type = 'track'
			ORDER BY pi.position`)
			.map(({ artId, ...r }) => ({
				...r,
				title: r.title ?? 'Unknown track',
				artUrl: artId ? `/api/v1/music/art/${artId}?size=256` : null,
			}));
	}

	findByMovie(userId: string, movieId: string) {
		return this.database.db
			.select({
				id: playlists.id,
				name: playlists.name,
			})
			.from(playlistItems)
			.innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
			.where(
				and(
					eq(playlistItems.itemType, 'movie'),
					eq(playlistItems.itemId, movieId),
					eq(playlists.userId, userId),
				),
			)
			.all();
	}

	reorder(playlistId: string, movieIds: string[], userId?: string) {
		if (userId) this.assertOwner(playlistId, userId);
		this.bustCache();
		for (let i = 0; i < movieIds.length; i++) {
			const movieId = movieIds[i]!;
			this.database.db
				.update(playlistItems)
				.set({ position: i + 1 })
				.where(
					and(
						eq(playlistItems.playlistId, playlistId),
						eq(playlistItems.itemType, 'movie'),
						eq(playlistItems.itemId, movieId),
					),
				)
				.run();
		}

		this.database.db
			.update(playlists)
			.set({ updatedAt: nowISO() })
			.where(eq(playlists.id, playlistId))
			.run();
	}
}

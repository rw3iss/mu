import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryContentType, MovieListQuery } from '@mu/shared';
import { classifyGroupType, nowISO, paginationDefaults } from '@mu/shared';
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	type OnModuleInit,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { parseJsonArray, parseJsonObject, stringifyJsonObject } from '../common/json-fields.js';
import { DatabaseService } from '../database/database.service.js';
import {
	imdbRatings,
	jobHistory,
	movieFiles,
	movieGroups,
	movieMetadata,
	movies,
	playlistMovies,
	transcodeCache,
	userRatings,
	users,
	userWatchHistory,
	userWatchlist,
} from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { buildPrettyTitle, isDirtyTitle } from '../grouping/title-sanitiser.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { LibraryService } from '../library/library.service.js';
import { ThumbnailService } from '../media/thumbnail.service.js';
import { ImageService } from '../metadata/image.service.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { SubtitleService } from '../stream/subtitles/subtitle.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';

@Injectable()
export class MoviesService implements OnModuleInit {
	private readonly logger = new Logger('MoviesService');

	constructor(
		private readonly database: DatabaseService,
		private readonly jobManager: JobManagerService,
		private readonly libraryService: LibraryService,
		private readonly thumbnailService: ThumbnailService,
		private readonly imageService: ImageService,
		private readonly transcoderService: TranscoderService,
		private readonly subtitleService: SubtitleService,
		private readonly tmdb: TmdbProvider,
		private readonly metadataService: MetadataService,
		private readonly events: EventsService,
	) {}

	onModuleInit(): void {
		// Group mutations (ungroup, rename, confirm, re-match) change what the
		// interleaved library list returns. The grouping module emits this on any
		// such change so the cached list doesn't serve a stale / deleted group.
		this.events.on('groups:changed', () => this.invalidateListCache());

		// Any single-movie change (Refresh Metadata, rescan, clear-metadata,
		// poster/backdrop swap) updates the movies row but would otherwise keep
		// serving a stale cached list — even across a hard reload — until the 60s
		// TTL lapsed. Bust the list cache so the new poster/title/etc. appear at once.
		this.events.on('library:movie-updated', () => this.invalidateListCache());
	}

	private readonly listCache = new Map<string, { data: any; expires: number }>();
	private static readonly CACHE_TTL_MS = 60_000; // 60 seconds
	private static readonly CACHE_MAX_ENTRIES = 100;

	/** Invalidate all cached movie list results. */
	invalidateListCache(): void {
		this.listCache.clear();
	}

	private getCacheKey(query: MovieListQuery, userId?: string): string {
		return JSON.stringify({ ...query, userId });
	}

	findAll(query: MovieListQuery, userId?: string) {
		const cacheKey = this.getCacheKey(query, userId);
		const cached = this.listCache.get(cacheKey);
		if (cached && cached.expires > Date.now()) {
			return cached.data;
		}

		// Mixed Library view: interleave ungrouped movies with collapsed group
		// "stacks" in one server-paginated, sorted list (groups sorted by their
		// latest member's addedAt / earliest year / name). Keeps pagination and
		// sort order consistent across pages instead of dumping every group at
		// the end of each page.
		if (String((query as { interleaveGroups?: string }).interleaveGroups) === 'true') {
			const result = this.computeInterleaved(query, userId);
			this.cacheResult(cacheKey, result);
			return result;
		}

		const { page, pageSize, offset } = paginationDefaults(query);

		const conditions = [];

		// Exclude bookmarks from library views — they live in their own
		// section, accessed via the watchlist / Discover page.
		conditions.push(sql`(${movies.source} IS NULL OR ${movies.source} = 'library')`);

		// By default, hide hidden movies unless showHidden is explicitly set
		if (String(query.showHidden) !== 'true') {
			conditions.push(sql`(${movies.hidden} IS NULL OR ${movies.hidden} = 0)`);
		}

		// Filter watched/unwatched movies (requires userId for the join)
		if (String(query.hideWatched) === 'true' && userId) {
			conditions.push(
				sql`(${userWatchHistory.completed} IS NULL OR ${userWatchHistory.completed} = 0)`,
			);
		}

		if (String(query.watchedOnly) === 'true' && userId) {
			conditions.push(sql`${userWatchHistory.completed} = 1`);
		}

		if (query.search) {
			conditions.push(like(movies.title, `%${query.search}%`));
		}

		if (query.genre) {
			// Genres stored as JSON array in movie_metadata, use LIKE for containment
			conditions.push(like(movieMetadata.genres, `%"${query.genre}"%`));
		}

		if (query.yearFrom) {
			conditions.push(sql`${movies.year} >= ${query.yearFrom}`);
		}

		if (query.yearTo) {
			conditions.push(sql`${movies.year} <= ${query.yearTo}`);
		}

		// "Grouped only" filter — restrict to movies that belong to a
		// subgroup (i.e. members of a series / collection / etc).
		if (String((query as { groupedOnly?: string }).groupedOnly) === 'true') {
			conditions.push(sql`${movies.groupId} IS NOT NULL`);
		}

		// Inverse filter — hide every movie that belongs to a group.
		// Used by the Library "mixed" view, which renders ungrouped
		// movies plus collapsed group tiles alongside each other.
		if (String((query as { excludeGrouped?: string }).excludeGrouped) === 'true') {
			conditions.push(sql`${movies.groupId} IS NULL`);
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined;

		// Determine sort
		const sortOrder = query.sortOrder === 'asc' ? asc : desc;
		let orderBy;
		switch (query.sortBy) {
			case 'title':
				orderBy = sortOrder(movies.title);
				break;
			case 'year':
				orderBy = sortOrder(movies.year);
				break;
			case 'addedAt':
				orderBy = sortOrder(movies.addedAt);
				break;
			case 'runtime':
				orderBy = sortOrder(movies.runtimeMinutes);
				break;
			case 'rating':
				orderBy = sortOrder(userRatings.rating);
				break;
			case 'fileSize':
				orderBy = sortOrder(
					sql`(SELECT mf.file_size FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
				);
				break;
			default:
				orderBy = desc(movies.addedAt);
		}

		const selectFields = this.movieSelectFields();

		// Build query — always left-join userRatings for the current user
		const ratingJoinCond = userId
			? and(eq(movies.id, userRatings.movieId), eq(userRatings.userId, userId))
			: eq(movies.id, userRatings.movieId);

		const historyJoinCond = userId
			? and(eq(movies.id, userWatchHistory.movieId), eq(userWatchHistory.userId, userId))
			: eq(movies.id, userWatchHistory.movieId);

		let data;
		let total: number;

		// movie_metadata + imdb_ratings joins are applied unconditionally
		// now — both feed the card-chip fields in selectFields. The genre
		// branch additionally filters on metadata.genres.
		if (query.genre) {
			data = this.database.db
				.select(selectFields)
				.from(movies)
				.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
				.leftJoin(imdbRatings, eq(movies.imdbId, imdbRatings.tconst))
				.leftJoin(userRatings, ratingJoinCond)
				.leftJoin(userWatchHistory, historyJoinCond)
				.where(where)
				.orderBy(orderBy)
				.limit(pageSize)
				.offset(offset)
				.all();

			const countResult = this.database.db
				.select({ count: count() })
				.from(movies)
				.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
				.leftJoin(userWatchHistory, historyJoinCond)
				.where(where)
				.get();
			total = countResult?.count ?? 0;
		} else {
			data = this.database.db
				.select(selectFields)
				.from(movies)
				.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
				.leftJoin(imdbRatings, eq(movies.imdbId, imdbRatings.tconst))
				.leftJoin(userRatings, ratingJoinCond)
				.leftJoin(userWatchHistory, historyJoinCond)
				.where(where)
				.orderBy(orderBy)
				.limit(pageSize)
				.offset(offset)
				.all();

			const countResult = this.database.db
				.select({ count: count() })
				.from(movies)
				.leftJoin(userWatchHistory, historyJoinCond)
				.where(where)
				.get();
			total = countResult?.count ?? 0;
		}

		const hiddenResult = this.database.db
			.select({ count: count() })
			.from(movies)
			.where(sql`${movies.hidden} = 1`)
			.get();
		const hiddenCount = hiddenResult?.count ?? 0;

		const watchedCountResult = userId
			? this.database.db
					.select({ count: count() })
					.from(userWatchHistory)
					.where(
						and(
							eq(userWatchHistory.userId, userId),
							eq(userWatchHistory.completed, true),
						),
					)
					.get()
			: null;
		const watchedCount = watchedCountResult?.count ?? 0;

		const result = {
			movies: data.map((row) => this.mapMovieRow(row)),
			total,
			hiddenCount,
			watchedCount,
			page,
			pageSize,
			totalPages: Math.ceil(total / pageSize),
		};

		this.cacheResult(cacheKey, result);
		return result;
	}

	/** Cache a list result, evicting the oldest entry when at capacity. */
	private cacheResult(cacheKey: string, result: any): void {
		if (this.listCache.size >= MoviesService.CACHE_MAX_ENTRIES) {
			const firstKey = this.listCache.keys().next().value;
			if (firstKey) this.listCache.delete(firstKey);
		}
		this.listCache.set(cacheKey, {
			data: result,
			expires: Date.now() + MoviesService.CACHE_TTL_MS,
		});
	}

	/** SELECT shape shared by the flat list and the by-id hydration query. */
	private movieSelectFields() {
		return {
			id: movies.id,
			title: movies.title,
			originalTitle: movies.originalTitle,
			year: movies.year,
			overview: movies.overview,
			runtimeMinutes: movies.runtimeMinutes,
			posterUrl: movies.posterUrl,
			thumbnailUrl: movies.thumbnailUrl,
			backdropUrl: movies.backdropUrl,
			imdbId: movies.imdbId,
			tmdbId: movies.tmdbId,
			contentRating: movies.contentRating,
			hidden: movies.hidden,
			groupId: movies.groupId,
			groupEpisodeOrdinal: movies.groupEpisodeOrdinal,
			addedAt: movies.addedAt,
			updatedAt: movies.updatedAt,
			rating: userRatings.rating,
			// External-rating fields powering card chips (IMDb / RT / MC).
			metaImdbRating: movieMetadata.imdbRating,
			metaImdbVotes: movieMetadata.imdbVotes,
			datasetImdbRating: imdbRatings.averageRating,
			datasetImdbVotes: imdbRatings.numVotes,
			rtRating: movieMetadata.rottenTomatoesScore,
			metacriticRating: movieMetadata.metacriticScore,
			watchPosition: userWatchHistory.positionSeconds,
			watchCompleted: userWatchHistory.completed,
			durationSeconds: sql<number>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
		};
	}

	/** Map a raw movie row (from movieSelectFields) into the API movie shape. */
	private mapMovieRow(row: any) {
		const position = row.watchCompleted ? 0 : (row.watchPosition ?? 0);
		// Coalesce IMDb rating/votes: prefer movie_metadata (richer, from OMDB),
		// fall back to the daily-synced IMDB dataset. Drop the raw helper columns.
		const { metaImdbRating, metaImdbVotes, datasetImdbRating, datasetImdbVotes, ...rest } = row;
		return this.applyPosterFallback({
			...rest,
			imdbRating: metaImdbRating ?? datasetImdbRating ?? null,
			imdbVotes: metaImdbVotes ?? datasetImdbVotes ?? null,
			rating: row.rating ?? 0,
			watchPosition: position,
			durationSeconds: row.durationSeconds ?? 0,
			watched: !!row.watchCompleted,
		});
	}

	/** Fully hydrate a set of movies by id (same shape as the flat list rows). */
	private getMoviesByIds(ids: string[], userId?: string) {
		if (ids.length === 0) return [];
		const ratingJoinCond = userId
			? and(eq(movies.id, userRatings.movieId), eq(userRatings.userId, userId))
			: eq(movies.id, userRatings.movieId);
		const historyJoinCond = userId
			? and(eq(movies.id, userWatchHistory.movieId), eq(userWatchHistory.userId, userId))
			: eq(movies.id, userWatchHistory.movieId);
		const rows = this.database.db
			.select(this.movieSelectFields())
			.from(movies)
			.leftJoin(movieMetadata, eq(movies.id, movieMetadata.movieId))
			.leftJoin(imdbRatings, eq(movies.imdbId, imdbRatings.tconst))
			.leftJoin(userRatings, ratingJoinCond)
			.leftJoin(userWatchHistory, historyJoinCond)
			.where(inArray(movies.id, ids))
			.all();
		return rows.map((r) => this.mapMovieRow(r));
	}

	/** Sort key for a movie row in the interleaved view (mirrors the client's
	 *  MovieGrid item-sort so page windows line up with on-screen order). */
	private movieSortKey(m: any, sortBy?: string): number | string {
		switch (sortBy) {
			case 'title':
				return (m.title ?? '').toLowerCase();
			case 'year':
				return m.year ?? 0;
			case 'runtime':
				return m.runtime ?? 0;
			case 'rating':
				return m.rating ?? 0;
			case 'fileSize':
				return m.fileSize ?? 0;
			default:
				return m.addedAt ?? '';
		}
	}

	/** Sort key for a group "stack" in the interleaved view. Groups have no
	 *  rating/runtime/size, so non-date sorts fall back to the group's date. */
	private groupSortKey(g: any, sortBy?: string): number | string {
		switch (sortBy) {
			case 'title':
				return (g.name ?? '').toLowerCase();
			case 'year':
				return g.earliestYear ?? 0;
			default:
				return g.latestMemberAddedAt ?? g.updatedAt ?? '';
		}
	}

	/**
	 * Parent groups with the sort/render summary the /groups endpoint exposes
	 * (totalMembers, representative poster, latest-member addedAt, earliest year).
	 * Queried inline to avoid a cross-module dependency on the grouping module.
	 */
	private listParentGroupsWithSummary(): any[] {
		const parents = this.database.db
			.select()
			.from(movieGroups)
			.where(eq(movieGroups.type, 'parent'))
			.all();
		return parents.map((p) => {
			const summary = this.database.db
				.select({
					totalMembers: sql<number>`COUNT(${movies.id})`,
					poster: sql<
						string | null
					>`(SELECT poster_url FROM movies WHERE group_id IN (SELECT id FROM movie_groups WHERE parent_group_id = ${p.id}) AND poster_url IS NOT NULL ORDER BY group_episode_ordinal LIMIT 1)`,
					latestAdded: sql<string | null>`MAX(${movies.addedAt})`,
					earliestYear: sql<number | null>`MIN(${movies.year})`,
				})
				.from(movies)
				.innerJoin(movieGroups, eq(movieGroups.id, movies.groupId))
				.where(eq(movieGroups.parentGroupId, p.id))
				.get();
			return {
				...p,
				totalMembers: summary?.totalMembers ?? 0,
				posterUrl: p.posterUrl ?? summary?.poster ?? null,
				latestMemberAddedAt: summary?.latestAdded ?? null,
				earliestYear: summary?.earliestYear ?? null,
			};
		});
	}

	/**
	 * Build one paginated, sorted page that interleaves ungrouped movies with
	 * collapsed parent-group stacks. Returns the page's movies + the groups that
	 * fall in the same window; `total` counts movies + groups so pagination is
	 * correct. The client (MovieGrid) re-sorts the page with the same keys.
	 */
	/**
	 * Parses the `type` query param (comma-separated {@link LibraryContentType})
	 * into a Set. Returns `null` when no/empty filter is given, meaning "all
	 * types" — callers treat null as no restriction.
	 */
	private parseTypeFilter(query: MovieListQuery): Set<LibraryContentType> | null {
		const raw = (query as { type?: string }).type;
		if (!raw) return null;
		const valid = new Set<LibraryContentType>(['movie', 'series', 'collection']);
		const picked = new Set<LibraryContentType>();
		for (const part of raw.split(',')) {
			const t = part.trim() as LibraryContentType;
			if (valid.has(t)) picked.add(t);
		}
		return picked.size > 0 ? picked : null;
	}

	private computeInterleaved(query: MovieListQuery, userId?: string) {
		const { page, pageSize, offset } = paginationDefaults(query);
		const sortBy = query.sortBy;
		const dir = query.sortOrder === 'asc' ? 1 : -1;
		const search = (query.search ?? '').trim().toLowerCase();
		// Type filter: null = all. When set, standalone movies are included only
		// if 'movie' is selected, and each parent group only if its classified
		// type (series / collection) is selected.
		const types = this.parseTypeFilter(query);

		// --- ungrouped movie sort-keys ---
		const conds = [
			sql`(${movies.source} IS NULL OR ${movies.source} = 'library')`,
			sql`${movies.groupId} IS NULL`,
		];
		if (String(query.showHidden) !== 'true') {
			conds.push(sql`(${movies.hidden} IS NULL OR ${movies.hidden} = 0)`);
		}
		if (query.search) conds.push(like(movies.title, `%${query.search}%`));
		if (query.yearFrom) conds.push(sql`${movies.year} >= ${query.yearFrom}`);
		if (query.yearTo) conds.push(sql`${movies.year} <= ${query.yearTo}`);

		const ratingJoinCond = userId
			? and(eq(movies.id, userRatings.movieId), eq(userRatings.userId, userId))
			: eq(movies.id, userRatings.movieId);

		const includeMovies = !types || types.has('movie');
		const movieKeys = includeMovies
			? this.database.db
					.select({
						id: movies.id,
						title: movies.title,
						year: movies.year,
						addedAt: movies.addedAt,
						runtime: movies.runtimeMinutes,
						rating: userRatings.rating,
						fileSize: sql<number>`(SELECT mf.file_size FROM movie_files mf WHERE mf.movie_id = ${movies.id} LIMIT 1)`,
					})
					.from(movies)
					.leftJoin(userRatings, ratingJoinCond)
					.where(and(...conds))
					.all()
			: [];

		// --- parent group stacks (with sort summary), same shape the /groups
		// endpoint returns so the client renders them identically ---
		const groupById = new Map<string, any>();
		for (const g of this.listParentGroupsWithSummary()) {
			if (g.totalMembers <= 0) continue;
			if (search && !(g.name ?? '').toLowerCase().includes(search)) continue;
			if (types && !types.has(classifyGroupType(g.groupType))) continue;
			groupById.set(g.id, g);
		}

		// --- combine + sort (mirrors MovieGrid.interleave) ---
		type Item = { kind: 'movie' | 'group'; id: string; key: number | string };
		const items: Item[] = [
			...movieKeys.map(
				(m): Item => ({ kind: 'movie', id: m.id, key: this.movieSortKey(m, sortBy) }),
			),
			...[...groupById.values()].map(
				(g): Item => ({ kind: 'group', id: g.id, key: this.groupSortKey(g, sortBy) }),
			),
		];
		items.sort((a, b) => {
			const ka = a.key;
			const kb = b.key;
			if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir;
			return String(ka).localeCompare(String(kb)) * dir;
		});

		const total = items.length;
		const windowItems = items.slice(offset, offset + pageSize);

		// --- hydrate the window ---
		const movieIds = windowItems.filter((i) => i.kind === 'movie').map((i) => i.id);
		const fullMovies = this.getMoviesByIds(movieIds, userId);
		const movieById = new Map(fullMovies.map((m) => [m.id, m]));

		const pageMovies: any[] = [];
		const pageGroups: any[] = [];
		for (const it of windowItems) {
			if (it.kind === 'movie') {
				const m = movieById.get(it.id);
				if (m) pageMovies.push(m);
			} else {
				const g = groupById.get(it.id);
				if (g) pageGroups.push(g);
			}
		}

		const hiddenCount =
			this.database.db
				.select({ count: count() })
				.from(movies)
				.where(sql`${movies.hidden} = 1`)
				.get()?.count ?? 0;
		const watchedCount = userId
			? (this.database.db
					.select({ count: count() })
					.from(userWatchHistory)
					.where(
						and(
							eq(userWatchHistory.userId, userId),
							eq(userWatchHistory.completed, true),
						),
					)
					.get()?.count ?? 0)
			: 0;

		return {
			movies: pageMovies,
			groups: pageGroups,
			total,
			hiddenCount,
			watchedCount,
			page,
			pageSize,
			totalPages: Math.ceil(total / pageSize),
		};
	}

	/**
	 * Resolves either a library UUID, an existing bookmark UUID, or a
	 * namespaced key like `tmdb:603`. For `tmdb:<id>` keys without a
	 * matching local row, fetches metadata from TMDB and writes a stub
	 * `source='bookmark'` row so future visits are cached.
	 */
	async findOrFetchByKey(key: string, userId?: string) {
		if (!key.includes(':')) {
			return this.findById(key, userId);
		}
		const [scheme, idStr] = key.split(':', 2);
		if (scheme !== 'tmdb') {
			throw new BadRequestException(`Unsupported movie key scheme: ${scheme}`);
		}
		const tmdbId = Number.parseInt(idStr ?? '', 10);
		if (!Number.isFinite(tmdbId)) {
			throw new BadRequestException(`Invalid TMDB id: ${idStr}`);
		}

		const existing = this.database.db
			.select({ id: movies.id })
			.from(movies)
			.where(eq(movies.tmdbId, tmdbId))
			.get();
		if (existing) return this.findById(existing.id, userId);

		const details = await this.tmdb.getMovieDetails(tmdbId);
		if (!details) {
			throw new NotFoundException(`TMDB movie ${tmdbId} not found`);
		}

		const stubId = crypto.randomUUID();
		const now = nowISO();
		const year = details.release_date
			? Number.parseInt(details.release_date.slice(0, 4), 10)
			: null;

		this.database.db
			.insert(movies)
			.values({
				id: stubId,
				title: details.title,
				originalTitle: details.original_title ?? null,
				overview: details.overview ?? null,
				tagline: details.tagline ?? null,
				year: Number.isFinite(year) ? year : null,
				runtimeMinutes: details.runtime ?? null,
				releaseDate: details.release_date ?? null,
				tmdbId,
				imdbId: details.imdb_id ?? null,
				posterUrl: details.poster_path
					? `https://image.tmdb.org/t/p/w500${details.poster_path}`
					: null,
				backdropUrl: details.backdrop_path
					? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
					: null,
				source: 'bookmark',
				addedAt: now,
				updatedAt: now,
			})
			.run();

		// Seed movie_metadata with TMDB ratings inline so the first
		// response already carries star ratings — the background
		// refresh below will enrich the rest (cast, OMDB ratings,
		// keywords, etc.). Without this, the client sees no rating
		// until the refresh completes.
		const tmdbRating =
			typeof details.vote_average === 'number' && details.vote_average > 0
				? Math.round(details.vote_average * 10) / 10
				: null;
		const tmdbVotes =
			typeof details.vote_count === 'number' && details.vote_count > 0
				? details.vote_count
				: null;
		this.database.db
			.insert(movieMetadata)
			.values({
				id: crypto.randomUUID(),
				movieId: stubId,
				tmdbRating,
				tmdbVotes,
				source: 'tmdb',
				fetchedAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.run();

		// Pull full metadata (cast, crew, OMDB ratings, keywords, …) via
		// the existing refresh pipeline. Fire-and-forget — basic ratings
		// above are enough for the immediate response; everything else
		// fills in on the next visit.
		this.metadataService.refreshMetadata(stubId).catch((err) => {
			this.logger.warn(
				`Background refresh for tmdb stub ${tmdbId} failed: ${(err as Error).message}`,
			);
		});

		return this.findById(stubId, userId);
	}

	async findById(id: string, userId?: string) {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!movie) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		const metadata = this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, id))
			.get();

		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, id))
			.all();

		// Check watchlist status, user rating, and watch position if userId provided
		let inWatchlist = false;
		let userRating = 0;
		let watchPosition = 0;
		let durationSeconds = 0;
		let watched = false;
		if (userId) {
			const watchlistEntry = this.database.db
				.select()
				.from(userWatchlist)
				.where(and(eq(userWatchlist.userId, userId), eq(userWatchlist.movieId, id)))
				.get();
			inWatchlist = !!watchlistEntry;

			const ratingEntry = this.database.db
				.select()
				.from(userRatings)
				.where(and(eq(userRatings.userId, userId), eq(userRatings.movieId, id)))
				.get();
			userRating = ratingEntry?.rating ?? 0;

			const historyEntry = this.database.db
				.select()
				.from(userWatchHistory)
				.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.movieId, id)))
				.get();
			if (historyEntry) {
				// Position is the resume point. Don't zero it on completed —
				// the new completion lifecycle DELETEs entries on full-watch,
				// so any row that still exists represents a real resume point.
				watchPosition = historyEntry.positionSeconds ?? 0;
				watched = !!historyEntry.completed;
			}
		}

		// Get duration and file info from movie file
		const firstFile = files[0];
		if (firstFile) {
			durationSeconds = firstFile.durationSeconds ?? 0;
		}

		const fileInfo = firstFile
			? {
					containerFormat: firstFile.containerFormat,
					codecVideo: firstFile.codecVideo,
					codecAudio: firstFile.codecAudio,
					resolution: firstFile.resolution,
					videoWidth: firstFile.videoWidth,
					videoHeight: firstFile.videoHeight,
					videoBitDepth: firstFile.videoBitDepth,
					videoFrameRate: firstFile.videoFrameRate,
					videoProfile: firstFile.videoProfile,
					videoColorSpace: firstFile.videoColorSpace,
					hdr: firstFile.hdr,
					bitrate: firstFile.bitrate,
					fileSize: firstFile.fileSize,
					fileName: firstFile.fileName,
					filePath: firstFile.filePath,
					audioTracks: parseJsonArray(firstFile.audioTracks),
					subtitleTracks: parseJsonArray(firstFile.subtitleTracks),
				}
			: null;

		const activeJobs = this.jobManager.findJobsByPayload('movieId', id, 'pre-transcode', [
			'pending',
			'running',
		]);
		let status: 'idle' | 'processing' | 'processing_playable' = 'idle';
		if (activeJobs.length > 0) {
			// Check if partial cache is available for playback while still transcoding
			if (firstFile) {
				const enc = this.jobManager.findJobsByPayload('movieId', id, 'pre-transcode', [
					'running',
				]);
				if (enc.length > 0) {
					const quality = (enc[0]!.payload?.quality as string) || '1080p';
					const hasPartial = await this.transcoderService.hasPlayablePartialCache(
						firstFile.id,
						quality,
					);
					status = hasPartial ? 'processing_playable' : 'processing';
				} else {
					status = 'processing';
				}
			} else {
				status = 'processing';
			}
		}

		const playSettings = parseJsonObject(movie.playSettings);

		// Get cached transcode versions for this movie's files. sizeBytes
		// + segmentCount are populated by the transcoder when each cache
		// completes; both are nullable so older rows (pre-tracking) read
		// as null and the client falls back to hiding the size column.
		const cachedVersions: Array<{
			quality: string;
			completedAt: string;
			sizeBytes: number | null;
			segmentCount: number | null;
		}> = [];
		if (firstFile) {
			const caches = this.database.db
				.select({
					quality: transcodeCache.quality,
					completedAt: transcodeCache.completedAt,
					sizeBytes: transcodeCache.sizeBytes,
					segmentCount: transcodeCache.segmentCount,
				})
				.from(transcodeCache)
				.where(eq(transcodeCache.movieFileId, firstFile.id))
				.all();
			for (const c of caches) {
				cachedVersions.push({
					quality: c.quality,
					completedAt: c.completedAt,
					sizeBytes: c.sizeBytes ?? null,
					segmentCount: c.segmentCount ?? null,
				});
			}
		}

		return {
			...this.flattenMovie(movie, metadata, inWatchlist, userRating),
			status,
			watchPosition,
			watched,
			durationSeconds,
			fileInfo,
			playSettings,
			cachedVersions,
		};
	}

	/**
	 * Flatten a movie row + metadata into the shape the client expects.
	 */
	private flattenMovie(movie: any, metadata: any, inWatchlist = false, userRating = 0) {
		// Use thumbnailUrl as poster fallback when no TMDB poster is set
		const posterUrl = movie.posterUrl || movie.thumbnailUrl || '';
		const thumbnailUrl = movie.thumbnailUrl || '';

		// Directors / writers may be either bare strings ("Christopher
		// Nolan") or objects shaped like `{ name: string, ... }` (TMDB
		// response). Widen the parsed type so the `directors[0]?.name`
		// fallback below type-checks.
		const directors = parseJsonArray<string | { name?: string }>(metadata?.directors);
		const writers = parseJsonArray<string | { name?: string }>(metadata?.writers);

		return {
			id: movie.id,
			title: movie.title,
			year: movie.year ?? 0,
			overview: movie.overview ?? '',
			tagline: movie.tagline ?? undefined,
			posterUrl,
			thumbnailUrl,
			backdropUrl: movie.backdropUrl ?? '',
			trailerUrl: movie.trailerUrl ?? undefined,
			runtime: movie.runtimeMinutes ?? 0,
			releaseDate: movie.releaseDate ?? undefined,
			contentRating: movie.contentRating ?? undefined,
			language: movie.language ?? undefined,
			country: movie.country ?? undefined,
			source: movie.source ?? 'library',
			imdbId: movie.imdbId ?? undefined,
			tmdbId: movie.tmdbId ?? undefined,
			hidden: movie.hidden ?? false,
			addedAt: movie.addedAt ?? '',
			genres: parseJsonArray(metadata?.genres),
			cast: parseJsonArray(metadata?.cast),
			director:
				directors.length > 0
					? typeof directors[0] === 'string'
						? directors[0]
						: (directors[0]?.name ?? '')
					: undefined,
			directors: directors.length > 0 ? directors : undefined,
			writers: writers.length > 0 ? writers : undefined,
			keywords: parseJsonArray(metadata?.keywords),
			productionCompanies: parseJsonArray(metadata?.productionCompanies),
			budget: metadata?.budget ?? undefined,
			revenue: metadata?.revenue ?? undefined,
			imdbRating: metadata?.imdbRating ?? undefined,
			imdbVotes: metadata?.imdbVotes ?? undefined,
			tmdbRating: metadata?.tmdbRating ?? undefined,
			rtRating: metadata?.rottenTomatoesScore ?? undefined,
			metacriticRating: metadata?.metacriticScore ?? undefined,
			rating: userRating,
			inWatchlist,
			groupId: movie.groupId ?? null,
			groupEpisodeOrdinal: movie.groupEpisodeOrdinal ?? null,
		};
	}

	findRecent(limit: number = 20) {
		return this.database.db
			.select()
			.from(movies)
			.where(sql`(${movies.source} IS NULL OR ${movies.source} = 'library')`)
			.orderBy(desc(movies.addedAt))
			.limit(limit)
			.all()
			.map(this.applyPosterFallback);
	}

	/** Short-TTL cache for shared rolling-window growth counts. */
	private growthCountCache = new Map<string, { value: number; at: number }>();

	/** Count visible library movies added strictly after an ISO timestamp. */
	private countAddedSince(sinceIso: string): number {
		const r = this.database.db
			.select({ count: count() })
			.from(movies)
			.where(
				and(
					sql`(${movies.source} IS NULL OR ${movies.source} = 'library')`,
					sql`(${movies.hidden} IS NULL OR ${movies.hidden} = 0)`,
					sql`${movies.addedAt} > ${sinceIso}`,
				),
			)
			.get();
		return r?.count ?? 0;
	}

	/** Cached count for shared windows — reused within `ttlMs` across users. */
	private cachedCountSince(key: string, sinceIso: string, ttlMs: number): number {
		const now = Date.now();
		const hit = this.growthCountCache.get(key);
		if (hit && now - hit.at < ttlMs) return hit.value;
		const value = this.countAddedSince(sinceIso);
		this.growthCountCache.set(key, { value, at: now });
		return value;
	}

	/**
	 * Library-growth stats for the dashboard header. `sinceSession` counts
	 * titles added since the user's PREVIOUS login ("new since your last
	 * session"); `last24h` is a rolling 24-hour count, cached ~1 min and shared
	 * across users. Built to extend later with more windows (week/month/year)
	 * by adding more `cachedCountSince` calls.
	 */
	getLibraryGrowthStats(userId: string): {
		sinceSession: number;
		sinceDate: string | null;
		last24h: number;
	} {
		const u = userId
			? this.database.db
					.select({ prev: users.previousLoginAt, last: users.lastLoginAt })
					.from(users)
					.where(eq(users.id, userId))
					.get()
			: null;
		// Reference = the prior session's login. Fall back to the current login
		// (counts ~0 until they next log in) rather than account creation, which
		// would massively over-report on the first run after this ships.
		const sinceDate = u?.prev ?? u?.last ?? null;
		const sinceSession = sinceDate ? this.countAddedSince(sinceDate) : 0;
		const last24h = this.cachedCountSince(
			'window:24h',
			new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			60_000,
		);
		return { sinceSession, sinceDate, last24h };
	}

	/**
	 * Trending = what people are actually watching lately, across ALL users.
	 * Takes each user's most-recent `PER_USER_LIMIT` watches, aggregates by
	 * movie, and ranks by how many users watched it (instances) then by most-
	 * recent play. So a movie several people watched recently bubbles to the
	 * front; ties break toward the more recently played. Deleted movies drop
	 * out (getMoviesByIds only returns existing rows).
	 */
	getTrending(limit: number = 20, userId?: string) {
		const PER_USER_LIMIT = 20;

		// Globally newest-first; per-user slices below stay in recency order.
		const rows = this.database.db
			.select({
				userId: userWatchHistory.userId,
				movieId: userWatchHistory.movieId,
				watchedAt: userWatchHistory.watchedAt,
			})
			.from(userWatchHistory)
			.orderBy(desc(userWatchHistory.watchedAt))
			.all();

		// Each user's most-recent PER_USER_LIMIT watches.
		const byUser = new Map<string, { movieId: string; watchedAt: string }[]>();
		for (const r of rows) {
			const list = byUser.get(r.userId);
			if (!list) {
				byUser.set(r.userId, [{ movieId: r.movieId, watchedAt: r.watchedAt }]);
			} else if (list.length < PER_USER_LIMIT) {
				list.push({ movieId: r.movieId, watchedAt: r.watchedAt });
			}
		}

		// Aggregate across users: instances = how many users have it in their
		// recent list; lastWatched = the most recent play of it by anyone.
		const agg = new Map<string, { instances: number; lastWatched: string }>();
		for (const list of byUser.values()) {
			const seen = new Set<string>();
			for (const e of list) {
				if (seen.has(e.movieId)) continue;
				seen.add(e.movieId);
				const cur = agg.get(e.movieId);
				if (cur) {
					cur.instances += 1;
					if (e.watchedAt > cur.lastWatched) cur.lastWatched = e.watchedAt;
				} else {
					agg.set(e.movieId, { instances: 1, lastWatched: e.watchedAt });
				}
			}
		}

		const orderedIds = [...agg.entries()]
			.sort(
				(a, b) =>
					b[1].instances - a[1].instances ||
					b[1].lastWatched.localeCompare(a[1].lastWatched),
			)
			.slice(0, limit)
			.map(([movieId]) => movieId);

		// Fetch + restore the trending order (inArray doesn't preserve it).
		const byId = new Map(this.getMoviesByIds(orderedIds, userId).map((m) => [m.id, m]));
		return orderedIds.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);
	}

	search(q: string, userId?: string) {
		const ratingJoinCond = userId
			? and(eq(movies.id, userRatings.movieId), eq(userRatings.userId, userId))
			: eq(movies.id, userRatings.movieId);

		return this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				year: movies.year,
				overview: movies.overview,
				runtimeMinutes: movies.runtimeMinutes,
				posterUrl: movies.posterUrl,
				thumbnailUrl: movies.thumbnailUrl,
				backdropUrl: movies.backdropUrl,
				imdbId: movies.imdbId,
				tmdbId: movies.tmdbId,
				contentRating: movies.contentRating,
				hidden: movies.hidden,
				groupId: movies.groupId,
				groupEpisodeOrdinal: movies.groupEpisodeOrdinal,
				addedAt: movies.addedAt,
				rating: userRatings.rating,
			})
			.from(movies)
			.leftJoin(userRatings, ratingJoinCond)
			.where(like(movies.title, `%${q}%`))
			.orderBy(asc(movies.title))
			.limit(50)
			.all()
			.map(this.applyPosterFallback);
	}

	/**
	 * Federated-search helper: returns library hits normalized to the
	 * MovieSearchHit shape used by FederatedMovieSearchService. Keeps
	 * the search() method's UI-facing shape stable.
	 */
	async searchForFederation(
		query: string,
		userId: string,
	): Promise<
		Array<{
			movieId: string;
			imdbId?: string;
			tmdbId?: number;
			title: string;
			year?: number;
			posterUrl?: string;
			tmdbRating?: number;
			tmdbVotes?: number;
			imdbRating?: number;
			imdbVotes?: number;
			isOwned: boolean;
			sources: Array<'local'>;
			matchScore: number;
		}>
	> {
		const rows = this.search(query, userId).slice(0, 25);
		if (rows.length === 0) return [];

		// Look up ratings in one batched query so we don't pay 25 round
		// trips per search.
		const ids = rows.map((r) => r.id);
		const metaRows = this.database.db
			.select({
				movieId: movieMetadata.movieId,
				tmdbRating: movieMetadata.tmdbRating,
				tmdbVotes: movieMetadata.tmdbVotes,
				imdbRating: movieMetadata.imdbRating,
				imdbVotes: movieMetadata.imdbVotes,
			})
			.from(movieMetadata)
			.where(inArray(movieMetadata.movieId, ids))
			.all();
		const metaByMovieId = new Map(metaRows.map((m) => [m.movieId, m]));

		return rows.map((m) => {
			const meta = metaByMovieId.get(m.id);
			return {
				movieId: m.id,
				imdbId: m.imdbId ?? undefined,
				tmdbId: m.tmdbId ?? undefined,
				title: m.title,
				year: m.year ?? undefined,
				posterUrl: m.posterUrl ?? undefined,
				tmdbRating: meta?.tmdbRating ?? undefined,
				tmdbVotes: meta?.tmdbVotes ?? undefined,
				imdbRating: meta?.imdbRating ?? undefined,
				imdbVotes: meta?.imdbVotes ?? undefined,
				isOwned: true,
				sources: ['local'] as Array<'local'>,
				matchScore: 0,
			};
		});
	}

	/**
	 * For list views, fall back to thumbnailUrl when posterUrl is empty.
	 */
	private applyPosterFallback<
		T extends { posterUrl?: string | null; thumbnailUrl?: string | null },
	>(movie: T): T {
		if (!movie.posterUrl && movie.thumbnailUrl) {
			return { ...movie, posterUrl: movie.thumbnailUrl };
		}
		return movie;
	}

	update(
		id: string,
		data: Partial<{
			title: string;
			year: number;
			overview: string;
			posterUrl: string;
			backdropUrl: string;
			imdbId: string;
			tmdbId: number;
			runtimeMinutes: number;
			contentRating: string;
			tagline: string;
			releaseDate: string;
			language: string;
			country: string;
			trailerUrl: string;
			hidden: boolean;
			playSettings: string | null;
		}>,
	) {
		this.invalidateListCache();
		const existing = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!existing) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		// Merge partial playSettings into existing JSON rather than
		// replacing wholesale. Both sides go through `parseJsonObject`
		// so malformed / non-object payloads are silently dropped.
		if (data.playSettings !== undefined && data.playSettings !== null) {
			const incoming = parseJsonObject(data.playSettings);
			if (incoming) {
				const current = parseJsonObject(existing.playSettings) ?? {};
				const merged: Record<string, unknown> = { ...current, ...incoming };
				// Remove keys set to null in the incoming partial.
				for (const key of Object.keys(merged)) {
					if (merged[key] === null) delete merged[key];
				}
				data = { ...data, playSettings: stringifyJsonObject(merged) };
			}
		}

		this.database.db
			.update(movies)
			.set({ ...data, updatedAt: nowISO() })
			.where(eq(movies.id, id))
			.run();

		return this.findById(id);
	}

	/**
	 * Complete cleanup: remove all caches, related data, and the movie itself.
	 * Idempotent — returns silently if the movie does not exist.
	 */
	async purgeMovie(id: string) {
		this.invalidateListCache();
		const movie = this.database.db.select().from(movies).where(eq(movies.id, id)).get();
		if (!movie) return;

		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, id))
			.all();

		for (const file of files) {
			await this.transcoderService.clearCache(file.id);
			await this.subtitleService.clearCache(file.id);
		}

		this.thumbnailService.clearForMovie(id);
		await this.imageService.clearForMovie(id);

		this.database.db.delete(playlistMovies).where(eq(playlistMovies.movieId, id)).run();
		this.database.db.delete(jobHistory).where(eq(jobHistory.movieId, id)).run();
		this.database.db.delete(movies).where(eq(movies.id, id)).run();

		this.logger.log(`Purged movie: ${movie.title}`);
	}

	remove(id: string) {
		this.invalidateListCache();
		const existing = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!existing) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		this.database.db.delete(movies).where(eq(movies.id, id)).run();
		this.logger.log(`Deleted movie: ${existing.title}`);
	}

	async deleteFromDisk(id: string, deleteEnclosingFolder: boolean): Promise<void> {
		this.invalidateListCache();
		const movie = this.database.db.select().from(movies).where(eq(movies.id, id)).get();

		if (!movie) {
			throw new NotFoundException(`Movie ${id} not found`);
		}

		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, id))
			.all();

		// Safety: never delete a folder that IS a configured library root.
		// We don't hard-fail — we just downgrade that file to file-only so
		// the movie still gets removed while the source root is preserved.
		const sourcePaths = deleteEnclosingFolder
			? this.libraryService.getSources().map((s) => path.resolve(s.path))
			: [];

		// Delete files and caches
		for (const file of files) {
			await rm(file.filePath, { force: true });
			if (deleteEnclosingFolder) {
				const dir = path.resolve(path.dirname(file.filePath));
				if (sourcePaths.includes(dir)) {
					this.logger.warn(
						`Skipping enclosing-folder delete for "${dir}" — it is a library source root`,
					);
				} else {
					await rm(dir, { recursive: true, force: true });
				}
			}
			await this.transcoderService.clearCache(file.id);
			await this.subtitleService.clearCache(file.id);
		}

		this.thumbnailService.clearForMovie(id);
		await this.imageService.clearForMovie(id);

		// Remove DB row (cascades handle FK tables)
		this.remove(id);

		this.logger.log(`Deleted movie from disk: ${movie.title}`);
	}

	getGenres(): string[] {
		const rows = this.database.db
			.select({ genres: movieMetadata.genres })
			.from(movieMetadata)
			.all();

		const genreSet = new Set<string>();
		for (const row of rows) {
			for (const g of parseJsonArray<unknown>(row.genres)) {
				if (typeof g === 'string' && g.trim()) genreSet.add(g.trim());
			}
		}

		return Array.from(genreSet).sort();
	}

	bulkAction(
		action: string,
		movieIds: string[],
		_userId: string,
		_extra?: { playlistId?: string },
	) {
		this.invalidateListCache();
		const results = { processed: 0, errors: [] as string[] };

		for (const movieId of movieIds) {
			try {
				switch (action) {
					case 'delete':
						this.remove(movieId);
						break;
					default:
						// Other bulk actions (mark_watched, add_to_playlist, refresh_metadata)
						// are delegated from the controller to the appropriate service
						break;
				}
				results.processed++;
			} catch (err: any) {
				results.errors.push(`${movieId}: ${err.message}`);
			}
		}

		return results;
	}

	/**
	 * Sweep every movie that has no remote metadata (tmdbId is null —
	 * the filename was the title and nothing ever overwrote it) and
	 * rewrite its title using the title-sanitiser. Idempotent: if the
	 * resulting title equals the current title, no UPDATE issued.
	 *
	 * Backs the Admin → Sanitize Title Names action.
	 */
	sanitizeUnmatchedTitles(): {
		scanned: number;
		updated: number;
		sample: Array<{ from: string; to: string }>;
	} {
		const candidates = this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				filePath: movieFiles.filePath,
			})
			.from(movies)
			.leftJoin(movieFiles, eq(movieFiles.movieId, movies.id))
			.where(sql`${movies.tmdbId} IS NULL`)
			.all();

		const sample: Array<{ from: string; to: string }> = [];
		let updated = 0;
		for (const row of candidates) {
			// Default mode: only overwrite when raw is dirty or filename
			// surfaces new SE info — protects already-clean titles.
			const r = this.applyTitleSanitiser(row.id, row.title, row.filePath, false);
			if (!r) continue;
			if (sample.length < 10) sample.push({ from: r.from, to: r.to });
			updated++;
		}

		if (updated > 0) {
			this.invalidateListCache();
			this.logger.log(`Sanitized ${updated} of ${candidates.length} unmatched titles`);
		}
		return { scanned: candidates.length, updated, sample };
	}

	/**
	 * Sanitise a single movie's title and return the updated row. Used
	 * by the MovieDetail page's "Sanitize Title Name" action. Unlike the
	 * bulk sweep this is `force=true` — the user explicitly opted in,
	 * so we'll overwrite even already-clean-looking titles if the
	 * sanitiser thinks it can produce something cleaner. We still skip
	 * the write when the result equals the existing title.
	 */
	sanitizeMovieTitle(movieId: string): { from: string; to: string } | null {
		const row = this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				filePath: movieFiles.filePath,
			})
			.from(movies)
			.leftJoin(movieFiles, eq(movieFiles.movieId, movies.id))
			.where(eq(movies.id, movieId))
			.get();
		if (!row) throw new NotFoundException(`Movie ${movieId} not found`);
		const result = this.applyTitleSanitiser(row.id, row.title, row.filePath, true);
		if (result) {
			this.invalidateListCache();
		}
		return result;
	}

	private applyTitleSanitiser(
		id: string,
		rawTitle: string,
		filePath: string | null,
		force: boolean,
	): { from: string; to: string } | null {
		const raw = rawTitle;
		if (!raw) return null;
		// If the DB title is already clean, leave it alone in non-force
		// mode — cleaning the filename can produce worse output than the
		// existing clean DB title.
		const dbIsDirty = isDirtyTitle(raw);
		const fileBase = filePath ? path.basename(filePath, path.extname(filePath)) : null;
		// Choose source: filename when dirty (richer), otherwise the
		// DB title in place. In force mode prefer the filename when
		// available, so the user can rescue movies whose dirty filename
		// was already crammed into a partly-clean title field.
		const source = (dbIsDirty || force) && fileBase ? fileBase : raw;
		const cleaned = buildPrettyTitle(source);
		if (!cleaned || cleaned.length < 2 || cleaned === raw) return null;

		if (!force) {
			// Only overwrite on genuine upgrade — either dirty raw, or
			// filename surfaces SE info the raw lacked.
			const cleanedHasSE = /[\s-]S\d{2}E\d{2,3}\b/.test(cleaned);
			const rawHasSE = /[\s-]S\d{2}E\d{2,3}\b/i.test(raw);
			if (!dbIsDirty && !(cleanedHasSE && !rawHasSE)) return null;
		}

		this.database.db
			.update(movies)
			.set({ title: cleaned, updatedAt: nowISO() })
			.where(eq(movies.id, id))
			.run();
		return { from: raw, to: cleaned };
	}
}

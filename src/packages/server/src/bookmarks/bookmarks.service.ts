import { nowISO } from '@mu/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	movieMetadata,
	movies,
	userWatchlist,
	type NewMovie,
} from '../database/schema/index.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';

export interface BookmarkInput {
	tmdbId?: number | null;
	imdbId?: string | null;
	title?: string;
	year?: number | null;
}

/**
 * Bookmarks = movies the user wants to remember but doesn't own.
 * Schema-wise they're regular rows in the `movies` table with
 * `source='bookmark'` so all metadata / cast / ratings UI works
 * identically — only playback paths check `source` and refuse
 * (no movie_files entry exists anyway).
 *
 * `POST /bookmarks` accepts a TMDB id (or imdb id + title fallback),
 * fetches full metadata if missing, upserts the movie row, and adds
 * a `user_watchlist` entry so it shows up alongside the user's other
 * "want to watch" list.
 *
 * `DELETE /bookmarks/:movieId` removes the watchlist entry. The movie
 * row stays around — another user might have bookmarked the same
 * title, and the metadata is reusable. Orphan cleanup happens in a
 * scheduled job (TODO).
 */
@Injectable()
export class BookmarksService {
	private readonly logger = new Logger('BookmarksService');

	constructor(
		private readonly database: DatabaseService,
		private readonly tmdb: TmdbProvider,
	) {}

	/**
	 * Save a bookmark from external rec data. Returns the movieId.
	 *
	 * Resolution order:
	 *   1. If movie already exists (tmdbId or imdbId match), reuse it.
	 *   2. If tmdbId provided, fetch full TMDB details.
	 *   3. Otherwise create a stub row with whatever title/year we
	 *      have — metadata can populate later.
	 */
	async addBookmark(userId: string, input: BookmarkInput): Promise<string> {
		let movieId = this.findExistingMovieId(input);

		if (!movieId) {
			movieId = await this.createBookmarkMovie(input);
		}

		// Add to watchlist (idempotent — unique index catches duplicates).
		try {
			this.database.db
				.insert(userWatchlist)
				.values({
					id: crypto.randomUUID(),
					userId,
					movieId,
					addedAt: nowISO(),
				})
				.run();
		} catch (err: any) {
			// Unique constraint OK — already bookmarked.
			if (!/UNIQUE/i.test(err?.message ?? '')) {
				throw err;
			}
		}

		return movieId;
	}

	/** Remove a bookmark from the user's watchlist. */
	removeBookmark(userId: string, movieId: string): boolean {
		const result = this.database.db
			.delete(userWatchlist)
			.where(and(eq(userWatchlist.userId, userId), eq(userWatchlist.movieId, movieId)))
			.run();
		return result.changes > 0;
	}

	/** List all bookmarks (source='bookmark' movies in watchlist) for a user. */
	listBookmarks(userId: string): Array<{
		id: string;
		title: string;
		year: number | null;
		posterUrl: string | null;
		overview: string | null;
		tmdbId: number | null;
		imdbId: string | null;
		addedAt: string;
	}> {
		const rows = this.database.db
			.select({
				id: movies.id,
				title: movies.title,
				year: movies.year,
				posterUrl: movies.posterUrl,
				overview: movies.overview,
				tmdbId: movies.tmdbId,
				imdbId: movies.imdbId,
				addedAt: userWatchlist.addedAt,
			})
			.from(userWatchlist)
			.innerJoin(movies, eq(movies.id, userWatchlist.movieId))
			.where(and(eq(userWatchlist.userId, userId), eq(movies.source, 'bookmark')))
			.orderBy(desc(userWatchlist.addedAt))
			.all();
		return rows;
	}

	private findExistingMovieId(input: BookmarkInput): string | null {
		if (input.tmdbId != null) {
			const row = this.database.db
				.select({ id: movies.id })
				.from(movies)
				.where(eq(movies.tmdbId, input.tmdbId))
				.get();
			if (row) return row.id;
		}
		if (input.imdbId) {
			const row = this.database.db
				.select({ id: movies.id })
				.from(movies)
				.where(eq(movies.imdbId, input.imdbId))
				.get();
			if (row) return row.id;
		}
		return null;
	}

	private async createBookmarkMovie(input: BookmarkInput): Promise<string> {
		const id = crypto.randomUUID();
		const now = nowISO();

		let title = input.title ?? null;
		let year = input.year ?? null;
		let movieValues: NewMovie = {
			id,
			title: title ?? 'Untitled',
			year,
			source: 'bookmark',
			addedAt: now,
			updatedAt: now,
		};
		let metaValues: Record<string, unknown> | null = null;

		// Try to enrich with TMDB if we have an id.
		if (input.tmdbId != null) {
			try {
				const details = await this.tmdb.getMovieDetails(input.tmdbId);
				if (details) {
					title = details.title ?? title;
					movieValues = {
						...movieValues,
						title: title ?? 'Untitled',
						originalTitle:
							details.original_title !== details.title ? details.original_title : null,
						year: details.release_date
							? parseInt(details.release_date.slice(0, 4), 10) || year
							: year,
						overview: details.overview ?? null,
						tagline: details.tagline ?? null,
						runtimeMinutes: details.runtime ?? null,
						releaseDate: details.release_date ?? null,
						language: details.spoken_languages?.[0]?.iso_639_1 ?? null,
						country: details.production_countries?.[0]?.iso_3166_1 ?? null,
						posterUrl: this.tmdb.getImageUrl(details.poster_path),
						backdropUrl: this.tmdb.getImageUrl(details.backdrop_path, 'w1280'),
						imdbId: details.imdb_id ?? input.imdbId ?? null,
						tmdbId: details.id,
					};
					metaValues = {
						id: crypto.randomUUID(),
						movieId: id,
						genres: JSON.stringify(details.genres?.map((g) => g.name) ?? []),
						cast: JSON.stringify(
							(details.credits?.cast ?? []).slice(0, 15).map((c) => c.name),
						),
						directors: JSON.stringify(
							(details.credits?.crew ?? [])
								.filter((c) => c.job === 'Director')
								.map((c) => c.name),
						),
						writers: JSON.stringify(
							(details.credits?.crew ?? [])
								.filter((c) => c.department === 'Writing')
								.map((c) => c.name),
						),
						keywords: JSON.stringify(details.keywords?.keywords?.map((k) => k.name) ?? []),
						productionCompanies: JSON.stringify(
							details.production_companies?.map((c) => c.name) ?? [],
						),
						budget: details.budget ?? null,
						revenue: details.revenue ?? null,
						tmdbRating: details.vote_average ?? null,
						tmdbVotes: details.vote_count ?? null,
						source: 'tmdb',
						fetchedAt: now,
						updatedAt: now,
					};
				}
			} catch (err: any) {
				this.logger.warn(`TMDB enrichment failed for bookmark: ${err?.message}`);
			}
		}

		this.database.db.insert(movies).values(movieValues).run();
		if (metaValues) {
			this.database.db
				.insert(movieMetadata)
				.values(metaValues as any)
				.run();
		}
		return id;
	}
}

import { nowISO } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	type ExternalRecSource,
	movieExternalRecs,
	movies,
	type NewMovieExternalRec,
} from '../database/schema/index.js';

export interface IncomingExternalRec {
	rank: number;
	tmdbId?: number | null;
	imdbId?: string | null;
	title: string;
	year?: number | null;
	raw?: unknown;
}

/**
 * Owns reads + writes against `movie_external_recs`. Bulk-replaces a
 * provider's slice on each refresh (delete all rows for movie+source,
 * insert the new set) — keeps the data tightly consistent with the
 * provider's current API view and avoids partial-update races.
 *
 * Also resolves `target_movie_id` for inbound recs at write time when
 * the candidate is already in our library, so the external-cache
 * strategy doesn't have to join at read time.
 */
@Injectable()
export class ExternalRecsRepository {
	constructor(private readonly database: DatabaseService) {}

	replace(movieId: string, source: ExternalRecSource, recs: IncomingExternalRec[]): void {
		// Resolve local matches for the targets in one pass.
		const tmdbIds = recs.map((r) => r.tmdbId).filter((x): x is number => x != null);
		const imdbIds = recs.map((r) => r.imdbId).filter((x): x is string => !!x);

		const tmdbMatches =
			tmdbIds.length > 0
				? this.database.db
						.select({ id: movies.id, tmdbId: movies.tmdbId })
						.from(movies)
						.where(inArray(movies.tmdbId, tmdbIds))
						.all()
				: [];
		const imdbMatches =
			imdbIds.length > 0
				? this.database.db
						.select({ id: movies.id, imdbId: movies.imdbId })
						.from(movies)
						.where(inArray(movies.imdbId, imdbIds))
						.all()
				: [];

		const localByTmdb = new Map(
			tmdbMatches.map((m) => [m.tmdbId as number, m.id] as const),
		);
		const localByImdb = new Map(
			imdbMatches.map((m) => [m.imdbId as string, m.id] as const),
		);

		// Wipe existing rows for this (movie, source).
		this.database.db
			.delete(movieExternalRecs)
			.where(
				and(
					eq(movieExternalRecs.movieId, movieId),
					eq(movieExternalRecs.source, source),
				),
			)
			.run();

		if (recs.length === 0) return;

		const now = nowISO();
		const rows: NewMovieExternalRec[] = recs.map((r) => ({
			movieId,
			source,
			rank: r.rank,
			targetMovieId:
				(r.tmdbId != null ? localByTmdb.get(r.tmdbId) : undefined) ??
				(r.imdbId ? localByImdb.get(r.imdbId) : undefined) ??
				null,
			targetTmdb: r.tmdbId ?? null,
			targetImdb: r.imdbId ?? null,
			targetTitle: r.title,
			targetYear: r.year ?? null,
			raw: r.raw != null ? JSON.stringify(r.raw) : null,
			fetchedAt: now,
		}));

		this.database.db.insert(movieExternalRecs).values(rows).run();
	}

	deleteForMovie(movieId: string): void {
		this.database.db
			.delete(movieExternalRecs)
			.where(eq(movieExternalRecs.movieId, movieId))
			.run();
	}

	/**
	 * Called whenever a new movie lands in the library — back-fill
	 * `target_movie_id` on any existing rec rows that reference its
	 * tmdbId / imdbId. Cheap; runs once per add.
	 */
	backfillIncomingMovie(movieId: string, tmdbId?: number | null, imdbId?: string | null): void {
		if (tmdbId != null) {
			this.database.db
				.update(movieExternalRecs)
				.set({ targetMovieId: movieId })
				.where(eq(movieExternalRecs.targetTmdb, tmdbId))
				.run();
		}
		if (imdbId) {
			this.database.db
				.update(movieExternalRecs)
				.set({ targetMovieId: movieId })
				.where(eq(movieExternalRecs.targetImdb, imdbId))
				.run();
		}
	}
}

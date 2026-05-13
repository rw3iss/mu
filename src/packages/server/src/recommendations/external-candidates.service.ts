import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	movieExternalRecs,
	movies,
	type NewMovie,
} from '../database/schema/index.js';

export interface ExternalCandidate {
	movieId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	tmdbId: number | null;
	imdbId: string | null;
	source: 'external' | 'bookmark';
	/** True if we already enriched it (metadata + ideally embedding). */
	enriched: boolean;
	/** Best rank position across all `movie_external_recs` rows for this seed → this target. */
	bestRank: number;
	rawSources: string[];
}

/**
 * Bridges `movie_external_recs` (catalog of pointers) with the `movies`
 * table (stuff we actually rank). For every external recommendation
 * candidate that isn't yet in the DB, creates a stub row with
 * `source='external'` so the rest of the pipeline (strategies, scoring,
 * embeddings) can operate on it uniformly.
 *
 * Stub rows carry only what `movie_external_recs` gave us: title, year,
 * tmdb_id, raw poster path. The enrichment job upgrades them in the
 * background by hitting TMDB for full details — that fires
 * `MOVIE_METADATA_UPDATED`, which the embedding listener picks up
 * automatically. No extra wiring needed.
 */
@Injectable()
export class ExternalCandidatesService {
	private readonly logger = new Logger('ExternalCandidatesService');

	constructor(private readonly database: DatabaseService) {}

	/**
	 * Returns all candidate movies (external + bookmark) referenced by
	 * the given seed movies' recommendation cache. Creates stub rows
	 * for new tmdb_ids so the caller has a real `movieId` to score.
	 */
	collectForSeeds(seedMovieIds: readonly string[]): ExternalCandidate[] {
		if (seedMovieIds.length === 0) return [];

		const recRows = this.database.db
			.select({
				source: movieExternalRecs.source,
				rank: movieExternalRecs.rank,
				targetMovieId: movieExternalRecs.targetMovieId,
				targetTmdb: movieExternalRecs.targetTmdb,
				targetImdb: movieExternalRecs.targetImdb,
				targetTitle: movieExternalRecs.targetTitle,
				targetYear: movieExternalRecs.targetYear,
				raw: movieExternalRecs.raw,
			})
			.from(movieExternalRecs)
			.where(inArray(movieExternalRecs.movieId, [...seedMovieIds]))
			.all();

		// 1. Already-mapped candidates → resolve via movies table.
		// 2. Unmapped → resolve by tmdb / imdb, or create stub.
		const tmdbIds = Array.from(
			new Set(recRows.map((r) => r.targetTmdb).filter((x): x is number => x != null)),
		);
		const imdbIds = Array.from(
			new Set(recRows.map((r) => r.targetImdb).filter((x): x is string => !!x)),
		);
		const movieRowIds = Array.from(
			new Set(recRows.map((r) => r.targetMovieId).filter((x): x is string => !!x)),
		);

		const existingById =
			movieRowIds.length > 0
				? this.database.db
						.select({
							id: movies.id,
							title: movies.title,
							year: movies.year,
							posterUrl: movies.posterUrl,
							tmdbId: movies.tmdbId,
							imdbId: movies.imdbId,
							source: movies.source,
						})
						.from(movies)
						.where(inArray(movies.id, movieRowIds))
						.all()
				: [];

		const existingByTmdb =
			tmdbIds.length > 0
				? this.database.db
						.select({
							id: movies.id,
							title: movies.title,
							year: movies.year,
							posterUrl: movies.posterUrl,
							tmdbId: movies.tmdbId,
							imdbId: movies.imdbId,
							source: movies.source,
						})
						.from(movies)
						.where(inArray(movies.tmdbId, tmdbIds))
						.all()
				: [];

		const existingByImdb =
			imdbIds.length > 0
				? this.database.db
						.select({
							id: movies.id,
							title: movies.title,
							year: movies.year,
							posterUrl: movies.posterUrl,
							tmdbId: movies.tmdbId,
							imdbId: movies.imdbId,
							source: movies.source,
						})
						.from(movies)
						.where(inArray(movies.imdbId, imdbIds))
						.all()
				: [];

		const byMovieId = new Map(existingById.map((m) => [m.id, m] as const));
		const byTmdb = new Map(
			existingByTmdb.map((m) => [m.tmdbId as number, m] as const),
		);
		const byImdb = new Map(existingByImdb.map((m) => [m.imdbId as string, m] as const));

		const accum = new Map<string, ExternalCandidate>();
		const stubsToCreate: NewMovie[] = [];

		for (const row of recRows) {
			let movieRow: {
				id: string;
				title: string;
				year: number | null;
				posterUrl: string | null;
				tmdbId: number | null;
				imdbId: string | null;
				source: string;
			} | null = null;
			if (row.targetMovieId) movieRow = byMovieId.get(row.targetMovieId) ?? null;
			if (!movieRow && row.targetTmdb != null) movieRow = byTmdb.get(row.targetTmdb) ?? null;
			if (!movieRow && row.targetImdb) movieRow = byImdb.get(row.targetImdb) ?? null;

			if (!movieRow) {
				// Need a stub. tmdb_id is the natural unique key for
				// external recs from TMDB / Trakt — skip rows without it.
				if (row.targetTmdb == null) continue;
				const id = crypto.randomUUID();
				const raw = parseRaw(row.raw);
				const posterUrl = raw?.poster_path
					? `https://image.tmdb.org/t/p/w500${raw.poster_path}`
					: null;
				stubsToCreate.push({
					id,
					title: row.targetTitle ?? `TMDB ${row.targetTmdb}`,
					year: row.targetYear ?? null,
					tmdbId: row.targetTmdb,
					imdbId: row.targetImdb ?? null,
					posterUrl,
					source: 'external',
					addedAt: nowISO(),
					updatedAt: nowISO(),
				});
				movieRow = {
					id,
					title: row.targetTitle ?? `TMDB ${row.targetTmdb}`,
					year: row.targetYear ?? null,
					posterUrl,
					tmdbId: row.targetTmdb,
					imdbId: row.targetImdb ?? null,
					source: 'external',
				};
				// Cache for subsequent rows that hit the same target.
				byTmdb.set(row.targetTmdb, movieRow);
			}

			// Skip library candidates — caller handles those through the
			// normal in-library pipeline.
			if (movieRow.source === 'library') continue;

			const current = accum.get(movieRow.id);
			if (current) {
				if (row.rank < current.bestRank) current.bestRank = row.rank;
				if (!current.rawSources.includes(row.source)) current.rawSources.push(row.source);
			} else {
				accum.set(movieRow.id, {
					movieId: movieRow.id,
					title: movieRow.title,
					year: movieRow.year,
					posterUrl: movieRow.posterUrl,
					tmdbId: movieRow.tmdbId,
					imdbId: movieRow.imdbId,
					source: movieRow.source === 'bookmark' ? 'bookmark' : 'external',
					enriched: this.isEnriched(movieRow.id),
					bestRank: row.rank,
					rawSources: [row.source],
				});
			}
		}

		// Bulk-create stubs in one insert.
		if (stubsToCreate.length > 0) {
			try {
				this.database.db.insert(movies).values(stubsToCreate).run();
				// Back-fill movie_external_recs.target_movie_id for the new stubs.
				for (const stub of stubsToCreate) {
					if (stub.tmdbId != null) {
						this.database.db
							.update(movieExternalRecs)
							.set({ targetMovieId: stub.id })
							.where(
								and(
									eq(movieExternalRecs.targetTmdb, stub.tmdbId),
									isNull(movieExternalRecs.targetMovieId),
								),
							)
							.run();
					}
				}
				this.logger.debug(`Created ${stubsToCreate.length} external movie stub(s)`);
			} catch (err: any) {
				this.logger.warn(`Stub insert failed: ${err?.message ?? err}`);
			}
		}

		return Array.from(accum.values());
	}

	/**
	 * Quick check whether a candidate has been enriched (has metadata
	 * row). Used to decide whether to enqueue an enrichment job.
	 */
	listIdsNeedingEnrichment(candidateIds: readonly string[]): string[] {
		if (candidateIds.length === 0) return [];
		// A movie has been enriched if it's NOT a stub — i.e. it has
		// an overview OR genres OR an updated metadata row. Cheap proxy:
		// `overview IS NOT NULL`. The enrichment job populates it.
		const rows = this.database.db
			.select({ id: movies.id, overview: movies.overview })
			.from(movies)
			.where(inArray(movies.id, [...candidateIds]))
			.all();
		return rows.filter((r) => !r.overview).map((r) => r.id);
	}

	private isEnriched(movieId: string): boolean {
		const row = this.database.db
			.select({ overview: movies.overview })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		return !!row?.overview;
	}
}

function parseRaw(raw: string | null): { poster_path?: string } | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

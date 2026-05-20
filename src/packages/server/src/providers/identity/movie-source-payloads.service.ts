import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { movieSourcePayloads } from '../../database/schema/index.js';

/**
 * Stores raw per-source payloads so the MergeEngine can re-merge
 * without re-fetching when rules / precedence change.
 *
 * One row per (movieId, source, fetchedAt). We keep the LATEST per
 * (movieId, source) as the authoritative source value; older rows
 * survive as history (useful for diffing how TMDB's idea of a movie
 * has changed across re-fetches).
 *
 * Caller responsibilities:
 *   - Pass already-stringified JSON (don't double-stringify).
 *   - Use ISO timestamps for fetchedAt.
 */
@Injectable()
export class MovieSourcePayloadsService {
	constructor(private readonly database: DatabaseService) {}

	async store(args: {
		movieId: string;
		source: string;
		payload: unknown;
		fetchedAt?: string;
	}): Promise<string> {
		const id = randomUUID();
		const payloadJson =
			typeof args.payload === 'string' ? args.payload : JSON.stringify(args.payload);
		this.database.db
			.insert(movieSourcePayloads)
			.values({
				id,
				movieId: args.movieId,
				source: args.source,
				payload: payloadJson,
				fetchedAt: args.fetchedAt ?? new Date().toISOString(),
			})
			.run();
		return id;
	}

	/**
	 * Get the latest payload from `source` for `movieId`. Parses the
	 * JSON for the caller. Returns null if we've never fetched.
	 */
	async getLatest<T = unknown>(movieId: string, source: string): Promise<T | null> {
		const row = this.database.db
			.select({ payload: movieSourcePayloads.payload })
			.from(movieSourcePayloads)
			.where(
				and(eq(movieSourcePayloads.movieId, movieId), eq(movieSourcePayloads.source, source)),
			)
			.orderBy(desc(movieSourcePayloads.fetchedAt))
			.limit(1)
			.get();
		if (!row) return null;
		try {
			return JSON.parse(row.payload) as T;
		} catch {
			return null;
		}
	}

	/**
	 * All distinct sources we have payloads for, on a given movie.
	 * Useful for the admin UI to show "this movie has been enriched
	 * by: TMDB, OMDB, Wikidata".
	 */
	async listSources(movieId: string): Promise<string[]> {
		const rows = this.database.db
			.select({ source: movieSourcePayloads.source })
			.from(movieSourcePayloads)
			.where(eq(movieSourcePayloads.movieId, movieId))
			.all();
		return Array.from(new Set(rows.map((r) => r.source)));
	}
}

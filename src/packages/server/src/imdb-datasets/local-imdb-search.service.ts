import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';

export interface LocalImdbHit {
	imdbId: string;
	title: string;
	originalTitle: string | null;
	year: number | null;
	runtimeMinutes: number | null;
	genres: string | null;
	rating: number | null;
	votes: number | null;
}

/**
 * Instant, offline title search over the local IMDB catalog
 * (`imdb_titles` ⋈ `imdb_ratings`). No API calls, no quotas, immune to
 * network/VPN flakiness — returns in single-digit milliseconds.
 *
 * Ranking: prefix matches first, then by vote count (popularity proxy),
 * so "Matrix" surfaces The Matrix before obscure shorts that merely
 * contain the word. Returns empty when the dataset hasn't been synced
 * (callers treat it as just another optional source).
 */
@Injectable()
export class LocalImdbSearchService {
	constructor(private readonly database: DatabaseService) {}

	search(query: string, limit = 15): LocalImdbHit[] {
		const q = (query ?? '').trim();
		if (q.length < 2) return [];
		const prefix = `${q}%`;
		const substr = `%${q}%`;
		try {
			const rows = this.database.db.all<{
				tconst: string;
				primary_title: string;
				original_title: string | null;
				year: number | null;
				runtime_minutes: number | null;
				genres: string | null;
				average_rating: number | null;
				num_votes: number | null;
			}>(sql`
				SELECT t.tconst, t.primary_title, t.original_title, t.year,
				       t.runtime_minutes, t.genres, r.average_rating, r.num_votes
				FROM imdb_titles t
				LEFT JOIN imdb_ratings r ON r.tconst = t.tconst
				WHERE t.primary_title LIKE ${substr} COLLATE NOCASE
				   OR t.original_title LIKE ${substr} COLLATE NOCASE
				ORDER BY (t.primary_title LIKE ${prefix} COLLATE NOCASE) DESC,
				         COALESCE(r.num_votes, 0) DESC
				LIMIT ${limit}
			`);
			return rows.map((r) => ({
				imdbId: r.tconst,
				title: r.primary_title,
				originalTitle: r.original_title,
				year: r.year,
				runtimeMinutes: r.runtime_minutes,
				genres: r.genres,
				rating: r.average_rating,
				votes: r.num_votes,
			}));
		} catch {
			// Table missing (migration not yet run) — behave as "no data".
			return [];
		}
	}

	/** True once the catalog has a meaningful number of rows. */
	isAvailable(): boolean {
		try {
			const r = this.database.db.get<{ n: number }>(
				sql`SELECT COUNT(*) AS n FROM (SELECT 1 FROM imdb_titles LIMIT 1000) sub`,
			);
			return (r?.n ?? 0) >= 1000;
		} catch {
			return false;
		}
	}
}

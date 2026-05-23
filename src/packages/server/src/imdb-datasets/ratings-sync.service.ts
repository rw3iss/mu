import { createGunzip } from 'node:zlib';
import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { count, sql } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { DatabaseService } from '../database/database.service.js';
import { imdbRatings } from '../database/schema/index.js';
import type { DatasetSync } from './dataset-sync.interface.js';

const RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
/** Batch insert size — ~5k rows per transaction keeps WAL writes
 *  tight while still hitting better-sqlite3's bulk-insert sweet spot. */
const BATCH_SIZE = 5_000;

/**
 * Streams `title.ratings.tsv.gz` from IMDB and upserts every row into
 * the local `imdb_ratings` table. Full reload each time — the file is
 * a daily snapshot, not a diff, so there's nothing to be gained by
 * incremental sync. A single transaction wraps the whole pass so a
 * mid-sync crash leaves the previous data intact.
 *
 * For a 1.4M-row dataset, expect ~30 s on a typical home connection.
 */
@Injectable()
export class RatingsSyncService implements DatasetSync {
	readonly id = 'title.ratings';
	readonly displayName = 'IMDB ratings & vote counts';
	readonly downloadUrl = RATINGS_URL;
	readonly approxSizeMb = 25;

	private readonly logger = new Logger('ImdbRatingsSync');

	constructor(private readonly database: DatabaseService) {}

	async sync(): Promise<{ rowsWritten: number; durationMs: number }> {
		const started = Date.now();
		this.logger.log(`Downloading ${RATINGS_URL}`);

		const res = await fetch(RATINGS_URL);
		if (!res.ok || !res.body) {
			throw new Error(`Download failed: HTTP ${res.status}`);
		}

		// fetch.body is a WHATWG ReadableStream; Node 18+ exposes a
		// helper to convert it to a regular Node Readable for pipe().
		const stream = Readable.fromWeb(res.body as any).pipe(createGunzip());
		const reader = createInterface({ input: stream, crlfDelay: Infinity });

		const now = nowISO();
		let headerSeen = false;
		let buffer: Array<{ tconst: string; rating: number; votes: number }> = [];
		let totalRows = 0;

		// Single transaction. better-sqlite3's transaction() returns a
		// function that runs the callback synchronously inside a
		// BEGIN/COMMIT block — far faster than per-row autocommits.
		const sqlite = (this.database.db as any).$client as import('better-sqlite3').Database;
		const upsertStmt = sqlite.prepare(
			`INSERT INTO imdb_ratings (tconst, average_rating, num_votes, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(tconst) DO UPDATE SET
			   average_rating = excluded.average_rating,
			   num_votes = excluded.num_votes,
			   updated_at = excluded.updated_at`,
		);
		const flush = sqlite.transaction(
			(rows: Array<{ tconst: string; rating: number; votes: number }>) => {
				for (const r of rows) {
					upsertStmt.run(r.tconst, r.rating, r.votes, now);
				}
			},
		);

		try {
			for await (const line of reader) {
				if (!line) continue;
				if (!headerSeen) {
					// First line is `tconst\taverageRating\tnumVotes`.
					headerSeen = true;
					continue;
				}
				const parts = line.split('\t');
				if (parts.length < 3) continue;
				const [tconst, ratingStr, votesStr] = parts;
				if (!tconst || tconst === '\\N') continue;
				const rating = parseFloat(ratingStr!);
				const votes = parseInt(votesStr!, 10);
				if (!Number.isFinite(rating) || !Number.isFinite(votes)) continue;
				buffer.push({ tconst, rating, votes });
				if (buffer.length >= BATCH_SIZE) {
					flush(buffer);
					totalRows += buffer.length;
					buffer = [];
				}
			}
			if (buffer.length > 0) {
				flush(buffer);
				totalRows += buffer.length;
			}
		} finally {
			reader.close();
		}

		const durationMs = Date.now() - started;
		this.logger.log(
			`Synced ${totalRows.toLocaleString()} IMDB ratings in ${(durationMs / 1000).toFixed(1)}s`,
		);
		return { rowsWritten: totalRows, durationMs };
	}

	count(): number {
		const row = this.database.db.select({ c: count() }).from(imdbRatings).get();
		return row?.c ?? 0;
	}

	/** Look up a single rating by IMDB tconst. Returns null on miss. */
	get(imdbId: string): { rating: number; votes: number; updatedAt: string } | null {
		const row = this.database.db
			.select()
			.from(imdbRatings)
			.where(sql`${imdbRatings.tconst} = ${imdbId}`)
			.get();
		if (!row) return null;
		return {
			rating: row.averageRating,
			votes: row.numVotes,
			updatedAt: row.updatedAt,
		};
	}
}

import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { count, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { imdbRatings } from '../database/schema/index.js';
import type { DatasetSync } from './dataset-sync.interface.js';

const RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';

/**
 * Rows per transaction. Small batches = small WAL increments, frequent
 * checkpoints, and more places we can yield to other queries. Trades
 * total throughput for sustained server responsiveness during the sync.
 */
const BATCH_SIZE = 500;

/**
 * Milliseconds to sleep between batches. Forces the sync into the
 * background even on a fast disk: at 1.4M rows / 500 = ~2800 batches,
 * `BATCH_SLEEP_MS=20` adds ~56s of pure idle to let other queries run.
 * Total runtime goes from ~30s to ~90s, but library reads stay snappy
 * even if the sync overlaps user traffic.
 */
const BATCH_SLEEP_MS = 20;

/**
 * Streams `title.ratings.tsv.gz` from IMDB and upserts CHANGED rows
 * into the local `imdb_ratings` table.
 *
 * Resource-tuned: most ratings don't change day-to-day, so each batch
 * does a `SELECT IN` against the existing rows and only writes the
 * diff. Combined with smaller batches + event-loop yields + temporary
 * PRAGMA relaxation, the sync runs cooler at the cost of taking ~3×
 * longer.
 *
 * Expected steady-state: ~50–200k writes per daily run (out of 1.4M
 * incoming rows).
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

		const stream = Readable.fromWeb(res.body as any).pipe(createGunzip());
		const reader = createInterface({ input: stream, crlfDelay: Infinity });

		const now = nowISO();
		const sqlite = (this.database.db as any).$client as import('better-sqlite3').Database;

		// PRAGMA relaxation while the sync runs:
		//   synchronous=NORMAL — still durable in a crash for WAL mode,
		//     but avoids fsync on every commit (default FULL fsyncs hard).
		//   busy_timeout — concurrent readers wait up to 5s instead of
		//     bailing out with SQLITE_BUSY.
		const prevSync = sqlite.pragma('synchronous', { simple: true });
		const prevBusy = sqlite.pragma('busy_timeout', { simple: true });
		sqlite.pragma('synchronous = NORMAL');
		sqlite.pragma('busy_timeout = 5000');

		const upsertStmt = sqlite.prepare(
			`INSERT INTO imdb_ratings (tconst, average_rating, num_votes, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(tconst) DO UPDATE SET
			   average_rating = excluded.average_rating,
			   num_votes = excluded.num_votes,
			   updated_at = excluded.updated_at`,
		);

		const flushChanged = sqlite.transaction(
			(rows: Array<{ tconst: string; rating: number; votes: number }>) => {
				for (const r of rows) {
					upsertStmt.run(r.tconst, r.rating, r.votes, now);
				}
			},
		);

		let headerSeen = false;
		let buffer: Array<{ tconst: string; rating: number; votes: number }> = [];
		let totalSeen = 0;
		let totalWritten = 0;
		let batches = 0;

		const processBatch = async () => {
			if (buffer.length === 0) return;
			const changed = this.selectChanged(sqlite, buffer);
			if (changed.length > 0) {
				flushChanged(changed);
				totalWritten += changed.length;
			}
			batches++;
			buffer = [];
			// Yield to the event loop so other I/O (HTTP requests,
			// scheduled jobs, filesystem watchers) can interleave.
			// `sleep(0)` macrotask-yields; longer sleep forces background priority.
			await sleep(BATCH_SLEEP_MS);
		};

		try {
			for await (const line of reader) {
				if (!line) continue;
				if (!headerSeen) {
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
				totalSeen++;
				if (buffer.length >= BATCH_SIZE) {
					await processBatch();
				}
			}
			if (buffer.length > 0) {
				await processBatch();
			}
		} finally {
			reader.close();
			// Restore PRAGMAs to whatever the rest of the app expects.
			sqlite.pragma(`synchronous = ${prevSync}`);
			sqlite.pragma(`busy_timeout = ${prevBusy}`);
		}

		const durationMs = Date.now() - started;
		const skipped = totalSeen - totalWritten;
		this.logger.log(
			`IMDB ratings sync: ${totalSeen.toLocaleString()} seen, ` +
				`${totalWritten.toLocaleString()} written, ` +
				`${skipped.toLocaleString()} unchanged, ` +
				`${batches} batches, ${(durationMs / 1000).toFixed(1)}s`,
		);
		return { rowsWritten: totalWritten, durationMs };
	}

	/**
	 * Per-batch diff: SELECT existing rows in one query, return only
	 * those whose rating or votes actually differ. Keeps memory bounded
	 * (no full-table preload) and avoids the bulk of write amplification.
	 */
	private selectChanged(
		sqlite: import('better-sqlite3').Database,
		batch: Array<{ tconst: string; rating: number; votes: number }>,
	): Array<{ tconst: string; rating: number; votes: number }> {
		// Build a parameterised IN clause sized to the batch — fast PK
		// lookup, cached by SQLite's prepared-statement cache.
		const placeholders = batch.map(() => '?').join(',');
		const rows = sqlite
			.prepare(
				`SELECT tconst, average_rating AS rating, num_votes AS votes
				 FROM imdb_ratings WHERE tconst IN (${placeholders})`,
			)
			.all(...batch.map((r) => r.tconst)) as Array<{
			tconst: string;
			rating: number;
			votes: number;
		}>;
		const existing = new Map<string, { rating: number; votes: number }>();
		for (const r of rows) existing.set(r.tconst, { rating: r.rating, votes: r.votes });

		const changed: typeof batch = [];
		for (const r of batch) {
			const e = existing.get(r.tconst);
			if (!e || e.rating !== r.rating || e.votes !== r.votes) {
				changed.push(r);
			}
		}
		return changed;
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

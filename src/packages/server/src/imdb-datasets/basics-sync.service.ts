import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { createGunzip } from 'node:zlib';
import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { count } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { imdbTitles } from '../database/schema/index.js';
import type { DatasetSync } from './dataset-sync.interface.js';

const BASICS_URL = 'https://datasets.imdbws.com/title.basics.tsv.gz';

/** Same cool-running profile as the ratings sync (see RatingsSyncService). */
const BATCH_SIZE = 500;
const BATCH_SLEEP_MS = 20;

/** Title types kept locally — feature films + TV movies. Everything else
 *  (episodes, shorts, video games, …) is filtered out during the stream,
 *  trimming ~11.7M source rows to ~700K. */
const KEEP_TYPES = new Set(['movie', 'tvMovie']);

/**
 * Streams `title.basics.tsv.gz` from IMDB and upserts the movie subset
 * into the local `imdb_titles` table. Combined with `imdb_ratings`
 * this forms the offline IMDB movie catalog used by local search.
 *
 * Most of the wall-clock is the download + decompress-parse of the full
 * 11.7M-line file (~3–6 min); writes are the filtered ~700K rows in
 * throttled batches. Unchanged rows still upsert (no per-row diff —
 * unlike ratings the change rate is tiny and the diff SELECTs would
 * cost more than the writes).
 */
@Injectable()
export class BasicsSyncService implements DatasetSync {
	readonly id = 'title.basics';
	readonly displayName = 'IMDB movie catalog (titles, years, genres)';
	readonly downloadUrl = BASICS_URL;
	readonly approxSizeMb = 250;

	private readonly logger = new Logger('ImdbBasicsSync');

	constructor(private readonly database: DatabaseService) {}

	async sync(): Promise<{ rowsWritten: number; durationMs: number }> {
		const started = Date.now();
		this.logger.log(`Downloading ${BASICS_URL}`);

		const res = await fetch(BASICS_URL);
		if (!res.ok || !res.body) {
			throw new Error(`Download failed: HTTP ${res.status}`);
		}

		const stream = Readable.fromWeb(res.body as any).pipe(createGunzip());
		const reader = createInterface({ input: stream, crlfDelay: Infinity });

		const now = nowISO();
		const sqlite = (this.database.db as any).$client as import('better-sqlite3').Database;

		const prevSync = sqlite.pragma('synchronous', { simple: true });
		const prevBusy = sqlite.pragma('busy_timeout', { simple: true });
		sqlite.pragma('synchronous = NORMAL');
		sqlite.pragma('busy_timeout = 5000');

		const upsertStmt = sqlite.prepare(
			`INSERT INTO imdb_titles
				(tconst, title_type, primary_title, original_title, year, runtime_minutes, genres, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(tconst) DO UPDATE SET
			   title_type = excluded.title_type,
			   primary_title = excluded.primary_title,
			   original_title = excluded.original_title,
			   year = excluded.year,
			   runtime_minutes = excluded.runtime_minutes,
			   genres = excluded.genres,
			   updated_at = excluded.updated_at`,
		);

		type Row = [
			string,
			string,
			string,
			string | null,
			number | null,
			number | null,
			string | null,
			string,
		];
		const flush = sqlite.transaction((rows: Row[]) => {
			for (const r of rows) upsertStmt.run(...r);
		});

		let headerSeen = false;
		let buffer: Row[] = [];
		let totalSeen = 0;
		let totalWritten = 0;

		const num = (v: string): number | null => {
			const n = Number(v);
			return v !== '\\N' && Number.isFinite(n) ? n : null;
		};

		for await (const line of reader) {
			if (!headerSeen) {
				headerSeen = true;
				continue;
			}
			totalSeen++;
			// tconst, titleType, primaryTitle, originalTitle, isAdult,
			// startYear, endYear, runtimeMinutes, genres
			const f = line.split('\t');
			if (f.length < 9) continue;
			if (!KEEP_TYPES.has(f[1]!) || f[4] === '1') continue;
			const title = f[2];
			if (!title || title === '\\N') continue;

			buffer.push([
				f[0]!,
				f[1]!,
				title,
				f[3] && f[3] !== '\\N' && f[3] !== title ? f[3] : null,
				num(f[5]!),
				num(f[7]!),
				f[8] && f[8] !== '\\N' ? f[8] : null,
				now,
			]);

			if (buffer.length >= BATCH_SIZE) {
				flush(buffer);
				totalWritten += buffer.length;
				buffer = [];
				await sleep(BATCH_SLEEP_MS);
			}
		}
		if (buffer.length > 0) {
			flush(buffer);
			totalWritten += buffer.length;
		}

		sqlite.pragma(`synchronous = ${prevSync}`);
		sqlite.pragma(`busy_timeout = ${prevBusy}`);

		const durationMs = Date.now() - started;
		this.logger.log(
			`Basics sync done: ${totalSeen} rows scanned, ${totalWritten} movies written in ${Math.round(durationMs / 1000)}s`,
		);
		return { rowsWritten: totalWritten, durationMs };
	}

	count(): number {
		const r = this.database.db.select({ count: count() }).from(imdbTitles).get();
		return r?.count ?? 0;
	}
}

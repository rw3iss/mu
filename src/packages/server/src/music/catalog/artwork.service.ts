import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { artwork } from '../../database/schema/index.js';

/** Fixed variant widths. Requests snap to the nearest at-or-above size. */
export const ARTWORK_SIZES = [64, 256, 600, 1200] as const;
export type ArtworkSize = (typeof ARTWORK_SIZES)[number];

const EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
};

/**
 * Album/artist art store. Originals are content-addressed (sha1) so the same
 * cover embedded in 12 tracks is stored once; resized JPEG variants are made
 * lazily with ffmpeg (no image library dependency) and cached under the cache
 * root.
 */
@Injectable()
export class ArtworkService {
	private readonly logger = new Logger('ArtworkService');
	private readonly building = new Map<string, Promise<string | null>>();

	constructor(
		private readonly config: ConfigService,
		private readonly database: DatabaseService,
	) {}

	private get originalsDir(): string {
		return join(this.config.get<string>('dataDir'), 'artwork');
	}

	private get variantsDir(): string {
		const cache = this.config.get<string>('cache.dir') || join(this.config.get<string>('dataDir'), 'cache');
		return join(cache, 'artwork');
	}

	/** Store bytes (deduplicated by hash) and return the artwork row id. */
	async store(
		bytes: Uint8Array,
		mime: string,
		kind: 'album' | 'artist',
		source: string,
	): Promise<string> {
		const hash = createHash('sha1').update(bytes).digest('hex');
		const existing = this.database.db
			.select({ id: artwork.id })
			.from(artwork)
			.where(eq(artwork.hash, hash))
			.get();
		if (existing) return existing.id;

		const ext = EXT_BY_MIME[mime.toLowerCase()] ?? 'jpg';
		const path = join(this.originalsDir, hash.slice(0, 2), `${hash}.${ext}`);
		await mkdir(dirname(path), { recursive: true });
		if (!existsSync(path)) {
			await writeFile(`${path}.part`, bytes);
			await rename(`${path}.part`, path);
		}
		const id = randomUUID();
		this.database.db
			.insert(artwork)
			.values({ id, kind, source, originalPath: path, hash, createdAt: nowISO() })
			.onConflictDoNothing()
			.run();
		// Lost an insert race on the hash → return the winner's id.
		const row = this.database.db.select({ id: artwork.id }).from(artwork).where(eq(artwork.hash, hash)).get();
		return row?.id ?? id;
	}

	async storeFile(filePath: string, kind: 'album' | 'artist', source: string): Promise<string | null> {
		try {
			const bytes = await readFile(filePath);
			const mime = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
			return await this.store(bytes, mime, kind, source);
		} catch (err) {
			this.logger.debug(`Could not read art ${filePath}: ${(err as Error).message}`);
			return null;
		}
	}

	static snapSize(requested: number): ArtworkSize {
		return ARTWORK_SIZES.find((s) => s >= requested) ?? 1200;
	}

	/** Path of a resized variant, building it on first request. */
	async variant(id: string, requested: number): Promise<string | null> {
		const row = this.database.db.select().from(artwork).where(eq(artwork.id, id)).get();
		if (!row) return null;
		const size = ArtworkService.snapSize(requested);
		const out = join(this.variantsDir, row.hash.slice(0, 2), `${row.hash}_${size}.jpg`);
		if (existsSync(out)) return out;
		const key = out;
		const inFlight = this.building.get(key);
		if (inFlight) return inFlight;
		const job = (async () => {
			await mkdir(dirname(out), { recursive: true });
			await new Promise<void>((resolve, reject) => {
				ffmpeg(row.originalPath)
					.outputOptions(['-vf', `scale='min(${size},iw)':-2`, '-q:v', '3', '-frames:v', '1'])
					.output(`${out}.part.jpg`)
					.on('end', () => resolve())
					.on('error', reject)
					.run();
			});
			await rename(`${out}.part.jpg`, out);
			return out;
		})()
			.catch(async (err) => {
				this.logger.warn(`Art variant failed for ${id}: ${(err as Error).message}`);
				await rm(`${out}.part.jpg`, { force: true });
				return row.originalPath;
			})
			.finally(() => this.building.delete(key));
		this.building.set(key, job);
		return job;
	}
}

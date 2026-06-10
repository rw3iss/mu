import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WsEvent } from '@mu/shared';
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
	PayloadTooLargeException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { LibraryService } from './library.service.js';
import { LibraryJobsService } from './library-jobs.service.js';

/** Hard ceiling per uploaded file (50 GB) — well above any real movie. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;

/** Top-level uploads must be a real movie file. */
const VIDEO_EXTS = new Set([
	'.mkv',
	'.mp4',
	'.avi',
	'.mov',
	'.m4v',
	'.webm',
	'.ts',
	'.m2ts',
	'.wmv',
	'.flv',
	'.mpg',
	'.mpeg',
]);

/** Files nested inside an uploaded folder may also be these companions. */
const COMPANION_EXTS = new Set([
	'.srt',
	'.sub',
	'.ass',
	'.ssa',
	'.vtt',
	'.idx',
	'.nfo',
	'.txt',
	'.json',
	'.jpg',
	'.jpeg',
	'.png',
	'.webp',
]);

/** Drop pending uploader attributions older than this (scan never matched). */
const ATTRIBUTION_TTL_MS = 2 * 60 * 60 * 1000;

export interface UploadTarget {
	id: string;
	path: string;
	label: string | null;
	/** Marked default in Settings → Library. */
	isDefault: boolean;
}

/**
 * Direct library uploads: a contributor/admin streams a movie file (or the
 * files of a folder, one request each) straight onto a configured media source
 * path, after which the source is rescanned so Mu picks the movie up. Writes
 * stream to disk (never buffered) so multi-GB files don't blow the heap, and
 * are placed at `<sourcePath>/<relativePath>` with the folder structure rebuilt.
 */
@Injectable()
export class LibraryUploadService {
	private readonly logger = new Logger(LibraryUploadService.name);

	/** absolute written path → uploader, consumed when the scan adds the movie. */
	private readonly pendingUploaders = new Map<string, { userId: string; at: number }>();

	constructor(
		private readonly library: LibraryService,
		private readonly libraryJobs: LibraryJobsService,
		private readonly events: EventsService,
		private readonly database: DatabaseService,
	) {
		// Attribute an uploaded movie to its uploader once the scan creates it.
		this.events.on(WsEvent.LIBRARY_MOVIE_ADDED, (data: unknown) => {
			this.attributeUpload(data as { movieId?: string }).catch(() => {});
		});
	}

	/** Enabled media source paths offered as upload destinations. */
	listTargets(): UploadTarget[] {
		return this.library
			.getSources()
			.filter((s) => s.enabled)
			.map((s) => ({
				id: s.id,
				path: s.path,
				label: s.label ?? null,
				isDefault: !!s.isDefault,
			}));
	}

	private resolveSource(sourceId: string) {
		const source = this.library.getSources().find((s) => s.id === sourceId);
		if (!source) throw new NotFoundException('Unknown library destination');
		if (!source.enabled) throw new BadRequestException('That library destination is disabled');
		return source;
	}

	/** Split a client relative path into safe segments (no traversal/absolute). */
	private segments(relativePath: string): string[] {
		const segs = String(relativePath || '')
			.split(/[\\/]+/)
			.filter(Boolean);
		if (!segs.length) throw new BadRequestException('Missing upload path');
		for (const seg of segs) {
			if (seg === '.' || seg === '..' || seg.includes('\0')) {
				throw new BadRequestException('Invalid upload path');
			}
		}
		return segs;
	}

	/** Resolve+validate the on-disk target, guaranteeing it stays in the source. */
	private safeTarget(sourcePath: string, segs: string[]): string {
		const root = path.resolve(sourcePath);
		const target = path.resolve(root, ...segs);
		if (target !== root && !target.startsWith(root + path.sep)) {
			throw new BadRequestException('Upload path escapes the library folder');
		}
		return target;
	}

	/**
	 * Conflict pre-check: which of these top-level entry names already exist in
	 * the source root (a single file name, or the root folder of a folder upload).
	 */
	preflight(sourceId: string, names: string[]): { conflicts: string[] } {
		const source = this.resolveSource(sourceId);
		const conflicts: string[] = [];
		for (const raw of names ?? []) {
			const seg = String(raw)
				.split(/[\\/]+/)
				.filter(Boolean)[0];
			if (!seg || seg === '.' || seg === '..') continue;
			if (existsSync(path.join(source.path, seg))) conflicts.push(seg);
		}
		return { conflicts };
	}

	/** Stream one uploaded file to its destination under the source path. */
	async writeUpload(opts: {
		sourceId: string;
		relativePath: string;
		userId: string;
		stream: NodeJS.ReadableStream & { truncated?: boolean };
		/** For server-driven progress (WS). */
		uploadId?: string;
		fileTotal?: number;
	}): Promise<{ bytes: number; target: string }> {
		const source = this.resolveSource(opts.sourceId);
		const segs = this.segments(opts.relativePath);
		const isTopLevel = segs.length === 1;
		const ext = path.extname(segs[segs.length - 1]!).toLowerCase();

		if (isTopLevel && !VIDEO_EXTS.has(ext)) {
			throw new BadRequestException(
				'Only movie files can be uploaded directly (upload a folder for extras/subtitles).',
			);
		}
		if (!isTopLevel && !VIDEO_EXTS.has(ext) && !COMPANION_EXTS.has(ext)) {
			throw new BadRequestException(
				`File type not allowed in a library upload: ${ext || 'unknown'}`,
			);
		}

		const target = this.safeTarget(source.path, segs);
		if (existsSync(target)) {
			throw new ConflictException(`Already exists in the library: ${opts.relativePath}`);
		}

		await mkdir(path.dirname(target), { recursive: true });
		const tmp = `${target}.uploading`;

		// Count bytes as they stream to disk and emit throttled WS progress —
		// this is ground-truth progress (what's actually been written), robust
		// to proxy/XHR quirks that can stall the browser's own upload events.
		const uploadId = opts.uploadId;
		const fileTotal = opts.fileTotal ?? 0;
		let written = 0;
		let lastEmit = 0;
		const events = this.events;
		const relativePath = opts.relativePath;
		const emit = () => {
			if (!uploadId) return;
			events.emit(WsEvent.UPLOAD_PROGRESS, { uploadId, relativePath, bytesWritten: written, fileTotal });
		};
		const counter = new Transform({
			transform(chunk: Buffer, _enc, cb) {
				written += chunk.length;
				const now = Date.now();
				if (now - lastEmit >= 400) {
					lastEmit = now;
					emit();
				}
				cb(null, chunk);
			},
		});

		try {
			await pipeline(opts.stream, counter, createWriteStream(tmp));
			emit(); // final 100% tick
		} catch (err) {
			await unlink(tmp).catch(() => {});
			throw err;
		}
		// @fastify/multipart flags truncation when the per-file limit is hit.
		if (opts.stream.truncated) {
			await unlink(tmp).catch(() => {});
			throw new PayloadTooLargeException('Upload exceeds the maximum allowed size');
		}

		await rename(tmp, target);
		const { size } = await stat(target);
		this.pendingUploaders.set(target, { userId: opts.userId, at: Date.now() });
		this.logger.log(
			`Uploaded ${opts.relativePath} → ${source.label ?? source.path} (${size}b)`,
		);
		return { bytes: size, target };
	}

	/** Kick off a scan of the destination so the upload is imported, + notify. */
	finalize(opts: { sourceId: string; uploadId: string; rootName: string; userId: string }): void {
		const source = this.resolveSource(opts.sourceId);
		this.libraryJobs.enqueueScan(source.id, `Upload: ${opts.rootName}`);
		this.events.emit(WsEvent.UPLOAD_COMPLETED, {
			uploadId: opts.uploadId,
			sourceId: source.id,
			rootName: opts.rootName,
			ok: true,
			userId: opts.userId,
		});
	}

	/** When a scanned-in movie matches an uploaded path, stamp uploaded_by. */
	private async attributeUpload(data: { movieId?: string }): Promise<void> {
		const movieId = data?.movieId;
		if (!movieId || this.pendingUploaders.size === 0) return;
		this.prunePending();

		const files = this.database.db
			.select({ filePath: movieFiles.filePath })
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.all();

		for (const f of files) {
			const hit = this.pendingUploaders.get(path.resolve(f.filePath));
			if (hit) {
				this.database.db
					.update(movies)
					.set({ uploadedBy: hit.userId })
					.where(eq(movies.id, movieId))
					.run();
				this.pendingUploaders.delete(path.resolve(f.filePath));
				return;
			}
		}
	}

	private prunePending(): void {
		const cutoff = Date.now() - ATTRIBUTION_TTL_MS;
		for (const [key, val] of this.pendingUploaders) {
			if (val.at < cutoff) this.pendingUploaders.delete(key);
		}
	}
}

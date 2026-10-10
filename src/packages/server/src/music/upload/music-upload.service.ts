import { randomUUID } from 'node:crypto';
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
import { inArray } from 'drizzle-orm';
import { parseFile } from 'music-metadata';
import { DatabaseService } from '../../database/database.service.js';
import { trackFiles } from '../../database/schema/index.js';
import { EventsService } from '../../events/events.service.js';
import { LibraryService } from '../../library/library.service.js';
import { AudioImporter } from '../catalog/audio-importer.js';
import {
	extOf,
	isAllowedMusicFile,
	isAudioExt,
	looseTrackSegments,
	resolveInside,
	safeSegments,
	ZIP_EXT,
} from './upload-paths.js';
import { commonRoot, extractZip, readZipEntries, ZipError } from './zip-reader.js';

/** Per-request ceiling (one file or one zip). */
export const MAX_MUSIC_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
/** Zip guards. */
export const MAX_ZIP_ENTRIES = 5000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 25 * 1024 * 1024 * 1024;
/** Forget an unfinalised upload batch after this long. */
const BATCH_TTL_MS = 6 * 60 * 60 * 1000;

export interface MusicUploadTarget {
	id: string;
	path: string;
	label: string | null;
	isDefault: boolean;
}

interface Batch {
	userId: string;
	sourceId: string;
	paths: Set<string>;
	at: number;
}

export interface MusicUploadResult {
	/** Paths written, relative to the source root. */
	written: string[];
	skipped: string[];
	bytes: number;
}

/**
 * Direct music uploads (docs/music-support-plan.md §5.2). One file per
 * request, streamed to disk (never buffered):
 * - a loose track goes to `<Artist>/<Album>/<file>` from its tags;
 * - a file inside a folder keeps its relative path;
 * - a `.zip` is streamed to a temp file in the source, then extracted.
 * `finalize` imports exactly the written paths (no full source scan) and
 * stamps `track_files.uploaded_by`.
 */
@Injectable()
export class MusicUploadService {
	private readonly logger = new Logger(MusicUploadService.name);
	private readonly batches = new Map<string, Batch>();

	constructor(
		private readonly library: LibraryService,
		private readonly importer: AudioImporter,
		private readonly events: EventsService,
		private readonly database: DatabaseService,
	) {}

	listTargets(): MusicUploadTarget[] {
		return this.library
			.getSources('audio')
			.filter((s) => s.enabled)
			.map((s) => ({
				id: s.id,
				path: s.path,
				label: s.label ?? null,
				isDefault: !!s.isDefault,
			}));
	}

	private resolveSource(sourceId: string) {
		const source = this.library.getSources('audio').find((s) => s.id === sourceId);
		if (!source) throw new NotFoundException('Unknown music folder');
		if (!source.enabled) throw new BadRequestException('That music folder is disabled');
		return source;
	}

	private segments(relativePath: string): string[] {
		try {
			return safeSegments(relativePath);
		} catch (err) {
			throw new BadRequestException((err as Error).message);
		}
	}

	private inside(root: string, segs: string[]): string {
		try {
			return resolveInside(root, segs);
		} catch (err) {
			throw new BadRequestException((err as Error).message);
		}
	}

	/** Which top-level folder names already exist in the source root. */
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

	private track(uploadId: string | undefined, userId: string, sourceId: string, abs: string[]) {
		if (!uploadId) return;
		this.prune();
		let b = this.batches.get(uploadId);
		if (!b) {
			b = { userId, sourceId, paths: new Set(), at: Date.now() };
			this.batches.set(uploadId, b);
		}
		for (const p of abs) b.paths.add(p);
		b.at = Date.now();
	}

	private prune(): void {
		const cutoff = Date.now() - BATCH_TTL_MS;
		for (const [k, v] of this.batches) if (v.at < cutoff) this.batches.delete(k);
	}

	/** Stream one request body to `tmp`, emitting WS byte progress. */
	private async streamTo(
		tmp: string,
		stream: NodeJS.ReadableStream & { truncated?: boolean },
		progress: { uploadId?: string; relativePath: string; fileTotal: number },
	): Promise<void> {
		let written = 0;
		let lastEmit = 0;
		const emit = () => {
			if (!progress.uploadId) return;
			this.events.emit(WsEvent.UPLOAD_PROGRESS, {
				uploadId: progress.uploadId,
				relativePath: progress.relativePath,
				bytesWritten: written,
				fileTotal: progress.fileTotal,
			});
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
		await mkdir(path.dirname(tmp), { recursive: true });
		try {
			await pipeline(stream, counter, createWriteStream(tmp));
			emit();
		} catch (err) {
			await unlink(tmp).catch(() => {});
			throw err;
		}
		if (stream.truncated) {
			await unlink(tmp).catch(() => {});
			throw new PayloadTooLargeException('Upload exceeds the maximum allowed size');
		}
	}

	async writeUpload(opts: {
		sourceId: string;
		relativePath: string;
		userId: string;
		stream: NodeJS.ReadableStream & { truncated?: boolean };
		uploadId?: string;
		fileTotal?: number;
	}): Promise<MusicUploadResult> {
		const source = this.resolveSource(opts.sourceId);
		const root = path.resolve(source.path);
		const segs = this.segments(opts.relativePath);
		const fileName = segs[segs.length - 1]!;
		const ext = extOf(fileName);
		const progress = {
			uploadId: opts.uploadId,
			relativePath: opts.relativePath,
			fileTotal: opts.fileTotal ?? 0,
		};
		const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/');

		if (ext === ZIP_EXT) {
			const tmp = path.join(root, `.mu-upload-${randomUUID()}.zip.part`);
			await this.streamTo(tmp, opts.stream, progress);
			try {
				const entries = await readZipEntries(tmp, { maxEntries: MAX_ZIP_ENTRIES });
				const single = commonRoot(entries);
				// Single-root archives extract as that folder; otherwise into a
				// folder named after the zip.
				const destDir = single
					? root
					: this.inside(root, [...segs.slice(0, -1), path.basename(fileName, ext)]);
				const result = await extractZip(tmp, destDir, {
					maxEntries: MAX_ZIP_ENTRIES,
					maxTotalBytes: MAX_ZIP_UNCOMPRESSED_BYTES,
					allow: isAllowedMusicFile,
				});
				if (result.written.length === 0) {
					throw new BadRequestException(
						result.skipped.length
							? 'Nothing new to import from that zip (no new audio/art files)'
							: 'That zip is empty',
					);
				}
				this.track(opts.uploadId, opts.userId, source.id, result.written);
				this.logger.log(
					`Extracted ${opts.relativePath}: ${result.written.length} files → ${source.path}`,
				);
				return {
					written: result.written.map(rel),
					skipped: result.skipped,
					bytes: result.totalBytes,
				};
			} catch (err) {
				if (err instanceof ZipError) throw new BadRequestException(err.message);
				throw err;
			} finally {
				await unlink(tmp).catch(() => {});
			}
		}

		const loose = segs.length === 1;
		if (loose && !isAudioExt(ext)) {
			throw new BadRequestException(
				'Upload an audio file, a folder, or a .zip (art/.cue/.lrc go inside a folder).',
			);
		}
		if (!loose && !isAllowedMusicFile(fileName)) {
			throw new BadRequestException(
				`File type not allowed in a music upload: ${ext || 'unknown'}`,
			);
		}

		let target: string;
		let tmp: string;
		if (loose) {
			// Destination depends on the tags, so land it first, then place it.
			tmp = path.join(root, `.mu-upload-${randomUUID()}${ext}.part`);
			await this.streamTo(tmp, opts.stream, progress);
			const tags = await parseFile(tmp, { duration: false, skipCovers: true })
				.then((m) => ({
					albumArtist: m.common.albumartist ?? null,
					artist: m.common.artist ?? null,
					album: m.common.album ?? null,
				}))
				.catch(() => ({ albumArtist: null, artist: null, album: null }));
			target = this.inside(root, looseTrackSegments(tags, fileName));
		} else {
			target = this.inside(root, segs);
			if (existsSync(target)) {
				throw new ConflictException(
					`Already exists in the music folder: ${opts.relativePath}`,
				);
			}
			tmp = `${target}.uploading`;
			await this.streamTo(tmp, opts.stream, progress);
		}

		if (existsSync(target)) {
			await unlink(tmp).catch(() => {});
			throw new ConflictException(`Already exists in the music folder: ${rel(target)}`);
		}
		await mkdir(path.dirname(target), { recursive: true });
		await rename(tmp, target);
		const { size } = await stat(target);
		this.track(opts.uploadId, opts.userId, source.id, [target]);
		this.logger.log(`Uploaded ${opts.relativePath} → ${target} (${size}b)`);
		return { written: [rel(target)], skipped: [], bytes: size };
	}

	/**
	 * Import exactly the paths this batch wrote (audio only — art/cue/lrc are
	 * picked up by the importer from the folder), stamp the uploader, then
	 * emit `UPLOAD_COMPLETED`. Runs in the background; returns the file count.
	 */
	finalize(opts: { sourceId: string; uploadId: string; rootName: string; userId: string }): {
		files: number;
	} {
		const source = this.resolveSource(opts.sourceId);
		const batch = this.batches.get(opts.uploadId);
		if (batch && batch.userId !== opts.userId) {
			throw new BadRequestException('Unknown upload');
		}
		this.batches.delete(opts.uploadId);
		const audio = [...(batch?.paths ?? [])].filter((p) => isAudioExt(extOf(p))).sort();

		void (async () => {
			let imported = 0;
			let failed = 0;
			for (const p of audio) {
				const r = await this.importer.importFile(source.id, p);
				if (r.status === 'error') failed++;
				else imported++;
			}
			for (let i = 0; i < audio.length; i += 500) {
				this.database.db
					.update(trackFiles)
					.set({ uploadedBy: opts.userId })
					.where(inArray(trackFiles.filePath, audio.slice(i, i + 500)))
					.run();
			}
			this.events.emit(WsEvent.UPLOAD_COMPLETED, {
				uploadId: opts.uploadId,
				sourceId: source.id,
				rootName: opts.rootName,
				ok: failed === 0,
				userId: opts.userId,
				kind: 'audio',
				imported,
				failed,
			});
		})().catch((err) => this.logger.warn(`Upload import failed: ${(err as Error).message}`));

		return { files: audio.length };
	}
}

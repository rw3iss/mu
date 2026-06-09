import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';

/** Supported image MIME types → file extension. */
const IMAGE_EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/avif': 'avif',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/tiff': 'tiff',
	'image/heic': 'heic',
	'image/heif': 'heif',
};

/** Additional media (video) MIME types → file extension. */
const VIDEO_EXT_BY_MIME: Record<string, string> = {
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'video/ogg': 'ogv',
	'video/quicktime': 'mov',
	'video/x-matroska': 'mkv',
	'video/x-msvideo': 'avi',
	'video/mpeg': 'mpeg',
	'video/3gpp': '3gp',
	'video/x-flv': 'flv',
};

/**
 * General-purpose store for user-provided files served publicly at `/uploads/*`.
 * Avatars use it today; chat/comment media will reuse the same pattern — each
 * kind picks its own `subdir` (e.g. `avatars`, `chat`). Files land under
 * `<dataDir>/uploads/<subdir>/` and are returned as `/uploads/<subdir>/<file>`
 * URLs that the Fastify static route serves verbatim.
 */
@Injectable()
export class UploadsService {
	private readonly logger = new Logger('UploadsService');

	constructor(private readonly config: ConfigService) {}

	private root(): string {
		return this.config.get<string>('uploads.dir');
	}

	/** True when the MIME type is an image kind we accept. */
	isSupportedImage(mimetype: string | undefined): boolean {
		return !!IMAGE_EXT_BY_MIME[(mimetype ?? '').toLowerCase()];
	}

	/** True when the MIME type is an image OR video kind we accept. */
	isSupportedMedia(mimetype: string | undefined): boolean {
		const m = (mimetype ?? '').toLowerCase();
		return !!IMAGE_EXT_BY_MIME[m] || !!VIDEO_EXT_BY_MIME[m] || m.startsWith('video/');
	}

	/**
	 * Persist an arbitrary media buffer (image or video) under `uploads/<subdir>/`.
	 * Extension is derived from the MIME type, falling back to the original
	 * filename's extension, then `bin`. Returns the public `/uploads/...` URL.
	 */
	async saveFile(
		buffer: Buffer,
		mimetype: string,
		subdir: string,
		originalName?: string | null,
	): Promise<string> {
		const m = (mimetype ?? '').toLowerCase();
		const ext =
			IMAGE_EXT_BY_MIME[m] ||
			VIDEO_EXT_BY_MIME[m] ||
			(originalName ? originalName.split('.').pop()?.toLowerCase() : '') ||
			'bin';
		const dir = join(this.root(), subdir);
		await mkdir(dir, { recursive: true });
		const name = `${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
		await writeFile(join(dir, name), buffer);
		this.logger.log(`Saved upload ${subdir}/${name} (${buffer.length} bytes, ${m || 'unknown'})`);
		return `/uploads/${subdir}/${name}`;
	}

	/**
	 * Persist an image buffer under `uploads/<subdir>/` and return its public
	 * URL (`/uploads/<subdir>/<uuid>.<ext>`). Throws if the MIME isn't an image.
	 */
	async saveImage(buffer: Buffer, mimetype: string, subdir: string): Promise<string> {
		const ext = IMAGE_EXT_BY_MIME[(mimetype ?? '').toLowerCase()];
		if (!ext) throw new Error(`Unsupported image type: ${mimetype}`);
		const dir = join(this.root(), subdir);
		await mkdir(dir, { recursive: true });
		const name = `${randomUUID()}.${ext}`;
		await writeFile(join(dir, name), buffer);
		this.logger.log(`Saved upload ${subdir}/${name} (${buffer.length} bytes)`);
		return `/uploads/${subdir}/${name}`;
	}

	/** Best-effort delete of a previously-saved upload, addressed by its URL. */
	async deleteByUrl(url: string | null | undefined): Promise<void> {
		if (!url || !url.startsWith('/uploads/')) return;
		const rel = url.slice('/uploads/'.length);
		// Refuse anything that could climb out of the uploads root.
		if (rel.includes('..')) return;
		try {
			await rm(join(this.root(), rel), { force: true });
		} catch {
			/* ignore — the file may already be gone */
		}
	}
}

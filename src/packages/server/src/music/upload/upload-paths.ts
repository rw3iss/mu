import path from 'node:path';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@mu/shared';

/** Audio extensions the importer handles (with leading dot). */
export const AUDIO_UPLOAD_EXTS = new Set(SUPPORTED_AUDIO_EXTENSIONS.map((e) => `.${e}`));

/** Companions allowed next to audio in a folder/zip upload. */
export const COMPANION_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.cue', '.lrc']);

export const ZIP_EXT = '.zip';

export function extOf(name: string): string {
	return path.extname(name).toLowerCase();
}

export function isAudioExt(ext: string): boolean {
	return AUDIO_UPLOAD_EXTS.has(ext);
}

/** Allowed inside a folder or zip upload: audio + art + `.cue` / `.lrc`. */
export function isAllowedMusicFile(name: string): boolean {
	const ext = extOf(name);
	return AUDIO_UPLOAD_EXTS.has(ext) || COMPANION_UPLOAD_EXTS.has(ext);
}

/**
 * Split a client/zip relative path into safe segments. Rejects traversal,
 * absolute paths, drive letters and NUL bytes. Throws `Error` with a message.
 */
export function safeSegments(relativePath: string): string[] {
	const raw = String(relativePath ?? '');
	if (raw.includes('\0')) throw new Error('Invalid path');
	if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
		throw new Error('Absolute paths are not allowed');
	}
	const segs = raw.split(/[\\/]+/).filter(Boolean);
	if (!segs.length) throw new Error('Missing path');
	for (const seg of segs) {
		if (seg === '.' || seg === '..') throw new Error('Path traversal is not allowed');
	}
	return segs;
}

/** Resolve segments under `root`; throws if the result escapes it (zip-slip). */
export function resolveInside(root: string, segs: string[]): string {
	const base = path.resolve(root);
	const target = path.resolve(base, ...segs);
	if (target === base || !target.startsWith(base + path.sep)) {
		throw new Error('Path escapes the music folder');
	}
	return target;
}

/** Make a tag value safe as one folder name (cross-platform). */
export function sanitizeSegment(value: string | null | undefined, fallback: string): string {
	const cleaned = String(value ?? '')
		// biome-ignore lint/suspicious/noControlCharactersInRegex: strip control chars
		.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.replace(/[. ]+$/, '')
		.slice(0, 120)
		.trim();
	return cleaned || fallback;
}

/**
 * Destination for a loose (top-level) track: `<Artist>/<Album>/<file>` from
 * its tags (album artist wins over track artist), or just `<file>` when the
 * file carries neither an artist nor an album tag.
 */
export function looseTrackSegments(
	tags: { albumArtist?: string | null; artist?: string | null; album?: string | null },
	fileName: string,
): string[] {
	const artist = (tags.albumArtist || tags.artist || '').trim();
	const album = (tags.album || '').trim();
	const file = sanitizeSegment(path.basename(fileName), 'track');
	if (!artist && !album) return [file];
	return [
		sanitizeSegment(artist, 'Unknown Artist'),
		sanitizeSegment(album, 'Unknown Album'),
		file,
	];
}

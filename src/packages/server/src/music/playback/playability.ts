import { type AudioQuality, audioQualityRank } from '@mu/shared';

/** Canonical codec keys, from music-metadata's `format.codec` strings. */
export type CodecKey =
	| 'mp3'
	| 'aac'
	| 'flac'
	| 'opus'
	| 'vorbis'
	| 'pcm'
	| 'alac'
	| 'aiff'
	| 'wma'
	| 'ape'
	| 'wavpack'
	| 'dsd'
	| 'unknown';

export function codecKey(codec: string | null | undefined, container?: string | null): CodecKey {
	const c = (codec ?? '').toLowerCase();
	const k = (container ?? '').toLowerCase();
	if (/layer 3|mp3|mpeg 1|mpeg 2/.test(c)) return 'mp3';
	if (/alac/.test(c)) return 'alac';
	if (/aac|mp4a/.test(c)) return 'aac';
	if (/flac/.test(c)) return 'flac';
	if (/opus/.test(c)) return 'opus';
	if (/vorbis/.test(c)) return 'vorbis';
	if (/dsd|dsf|dff/.test(c) || /dsf|dsdiff/.test(k)) return 'dsd';
	if (/wavpack/.test(c)) return 'wavpack';
	if (/monkey|ape/.test(c)) return 'ape';
	if (/wma|windows media/.test(c)) return 'wma';
	if (/aiff/.test(k)) return 'aiff';
	if (/pcm|lpcm/.test(c)) return 'pcm';
	return 'unknown';
}

/** Played by every target browser without asking (MP3, AAC, FLAC, WAV/PCM). */
const UNIVERSAL: ReadonlySet<CodecKey> = new Set(['mp3', 'aac', 'flac', 'pcm']);

/** Parse the client capability list (?caps=flac,opus,alac). */
export function parseCaps(raw: string | undefined | null): Set<CodecKey> {
	const caps = new Set<CodecKey>(UNIVERSAL);
	for (const part of (raw ?? '').split(',')) {
		const key = part.trim().toLowerCase() as CodecKey;
		if (key) caps.add(key);
	}
	return caps;
}

export function isPlayable(key: CodecKey, caps: Set<CodecKey>): boolean {
	return caps.has(key);
}

export const LOSSLESS_KEYS: ReadonlySet<CodecKey> = new Set([
	'flac',
	'pcm',
	'alac',
	'aiff',
	'ape',
	'wavpack',
	'dsd',
]);

export interface StreamPlan {
	/** Serve the untouched source, or a cached/built transcode. */
	mode: 'original' | 'transcode';
	/** Profile actually delivered (after the admin cap and no-upscale rules). */
	profile: AudioQuality;
	/** Transcode target (only when mode === 'transcode'). */
	target?: { codec: 'flac' | 'opus' | 'aac'; bitrateKbps?: number; ext: 'flac' | 'opus' | 'm4a' };
}

/** Apply the admin maximum: a requested profile can't exceed it. */
export function capProfile(requested: AudioQuality, max: AudioQuality): AudioQuality {
	return audioQualityRank(requested) < audioQualityRank(max) ? max : requested;
}

/**
 * Decide how to deliver one file. Rules:
 *  - original/lossless: send the source when the browser plays it; otherwise
 *    FLAC (lossless → lossless; a lossy unplayable source like WMA also goes to
 *    FLAC so quality is never lost a second time).
 *  - high/normal/low: Opus (or AAC when the browser lacks Opus) at the profile
 *    bitrate — unless the source is already playable and at or below that
 *    bitrate, in which case re-encoding would only lose quality.
 */
export function planStream(
	source: { codec: CodecKey; bitrate: number | null },
	requested: AudioQuality,
	max: AudioQuality,
	caps: Set<CodecKey>,
	bitrates: { high: number; normal: number; low: number },
): StreamPlan {
	const profile = capProfile(requested, max);
	const playable = isPlayable(source.codec, caps);
	if (profile === 'original' || profile === 'lossless') {
		if (playable) return { mode: 'original', profile };
		return { mode: 'transcode', profile, target: { codec: 'flac', ext: 'flac' } };
	}
	const kbps = bitrates[profile];
	const srcKbps = source.bitrate ? Math.round(source.bitrate / 1000) : null;
	if (playable && srcKbps != null && srcKbps <= kbps + 8) return { mode: 'original', profile };
	const opus = caps.has('opus');
	return {
		mode: 'transcode',
		profile,
		target: opus
			? { codec: 'opus', bitrateKbps: kbps, ext: 'opus' }
			: { codec: 'aac', bitrateKbps: kbps, ext: 'm4a' },
	};
}

export const MIME_BY_EXT: Record<string, string> = {
	flac: 'audio/flac',
	opus: 'audio/ogg; codecs=opus',
	m4a: 'audio/mp4',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	wav: 'audio/wav',
	aac: 'audio/aac',
};

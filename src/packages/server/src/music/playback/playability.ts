import { type AudioQuality, audioQualityRank, type MusicSettings } from '@mu/shared';

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

/** Admin transcode policy, from MusicSettings. */
export interface TranscodePolicy {
	/** FLAC transcodes allowed at all (off by default — FLAC is large). */
	allowLossless: boolean;
	/** Target for formats the browser can't play. */
	fallback: Exclude<AudioQuality, 'original'>;
}

export const DEFAULT_POLICY: TranscodePolicy = { allowLossless: false, fallback: 'high' };

export function policyOf(
	s: Pick<MusicSettings, 'allowLossless' | 'fallbackProfile'>,
): TranscodePolicy {
	const allowLossless = s.allowLossless === true;
	const fallback =
		s.fallbackProfile === 'lossless' && !allowLossless ? 'high' : (s.fallbackProfile ?? 'high');
	return { allowLossless, fallback };
}

/**
 * Decide how to deliver one file. Rules:
 *  - original: send the source when the browser plays it (FLAC stays FLAC).
 *    Otherwise transcode to the admin's fallback profile — lossy AAC by
 *    default (universal, ~1.4 MB/min at 192 kbps); FLAC only when the admin
 *    allows lossless AND picked it as the fallback.
 *  - lossless: like original, but unplayable sources go to FLAC. Only when
 *    lossless is allowed; otherwise it behaves as `original`.
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
	policy: TranscodePolicy = DEFAULT_POLICY,
): StreamPlan {
	let profile = capProfile(requested, max);
	if (profile === 'lossless' && !policy.allowLossless) profile = 'original';
	const playable = isPlayable(source.codec, caps);
	if (profile === 'original' || profile === 'lossless') {
		if (playable) return { mode: 'original', profile };
		const target = profile === 'lossless' ? 'lossless' : policy.fallback;
		if (target === 'lossless') {
			return {
				mode: 'transcode',
				profile: 'lossless',
				target: { codec: 'flac', ext: 'flac' },
			};
		}
		// AAC, not Opus: one cached copy that every browser (incl. Safari) plays.
		return {
			mode: 'transcode',
			profile: target,
			target: { codec: 'aac', bitrateKbps: bitrates[target], ext: 'm4a' },
		};
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

import {
	type AudioQuality,
	audioQualityRank,
	type MaxFormat,
	type MusicSettings,
} from '@mu/shared';

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
	target?: TranscodeTarget;
}

export interface TranscodeTarget {
	codec: 'flac' | 'opus' | 'aac' | 'mp3';
	/** Constant/average bitrate; absent for FLAC and MP3 V0. */
	bitrateKbps?: number;
	/** LAME VBR quality (0 = V0). */
	vbrQuality?: number;
	ext: 'flac' | 'opus' | 'm4a' | 'mp3';
	/** Output sample rate (Hz); null/absent = keep the source rate. */
	sampleRate?: number | null;
	/** FLAC only: output bits (24 for DSD). */
	bitDepth?: number;
}

/** Source facts the planner needs. */
export interface PlanSource {
	codec: CodecKey;
	bitrate: number | null;
	sampleRate?: number | null;
	bitDepth?: number | null;
}

/** Above CD/DAT resolution (or DSD) — worth keeping lossless when allowed. */
export function isHiRes(src: PlanSource): boolean {
	return src.codec === 'dsd' || (src.sampleRate ?? 0) > 48_000 || (src.bitDepth ?? 0) > 16;
}

/**
 * Lossy encoders top out at 48 kHz (Opus always runs at 48k). Keep the
 * source's rate family: 44.1/88.2/176.4k → 44.1k, everything else → 48k.
 * null = the source rate is already fine.
 */
export function lossyRate(
	srcRate: number | null | undefined,
	codec: 'opus' | 'aac' | 'mp3',
): number | null {
	if (codec === 'opus') return 48_000;
	if (!srcRate || srcRate <= 48_000) return null;
	return srcRate % 44_100 === 0 ? 44_100 : 48_000;
}

/**
 * FLAC rate for DSD: decimate by 16 (DSD64 → 176.4k, DSD128 → 352.8k), capped
 * at 352.8k. PCM sources keep their native rate (null).
 */
export function flacRate(src: PlanSource): number | null {
	if (src.codec !== 'dsd') return null;
	const r = src.sampleRate && src.sampleRate > 1_000_000 ? src.sampleRate / 16 : 176_400;
	return Math.min(352_800, r);
}

/** Cache file name for a plan — encodes everything that changes the bytes. */
export function cacheName(plan: StreamPlan): string | null {
	const t = plan.target;
	if (plan.mode !== 'transcode' || !t) return null;
	const parts: string[] = [plan.profile];
	if (t.vbrQuality != null) parts.push(`v${t.vbrQuality}`);
	else if (t.bitrateKbps) parts.push(String(t.bitrateKbps));
	if (t.sampleRate) parts.push(String(t.sampleRate));
	return `${parts.join('-')}.${t.ext}`;
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
	/** Encoding of the `max` quality. */
	maxFormat: MaxFormat;
}

export const DEFAULT_POLICY: TranscodePolicy = {
	allowLossless: false,
	fallback: 'high',
	maxFormat: 'aac',
};

export function policyOf(
	s: Pick<MusicSettings, 'allowLossless' | 'fallbackProfile'> &
		Partial<Pick<MusicSettings, 'maxFormat'>>,
): TranscodePolicy {
	const allowLossless = s.allowLossless === true;
	const fallback =
		s.fallbackProfile === 'lossless' && !allowLossless ? 'high' : (s.fallbackProfile ?? 'high');
	return { allowLossless, fallback, maxFormat: s.maxFormat ?? 'aac' };
}

/**
 * Decide how to deliver one file. Rules:
 *  - original: send the source when the browser plays it (FLAC stays FLAC).
 *    Otherwise transcode to the admin's fallback profile — lossy AAC by
 *    default (universal, ~1.4 MB/min at 192 kbps); FLAC only when the admin
 *    allows lossless AND picked it as the fallback.
 *  - lossless: like original, but unplayable sources go to FLAC. Only when
 *    lossless is allowed; otherwise it behaves as `original`.
 *  - Hi-res rule: with lossless allowed, unplayable hi-res sources (>48 kHz,
 *    >16-bit, DSD) go to FLAC at their native rate even under `original`.
 *  - max: AAC at `bitrates.max` (320) or MP3 V0 — the top lossy option.
 *  - high/normal/low: Opus (or AAC when the browser lacks Opus) at the profile
 *    bitrate — unless the source is already playable and at or below that
 *    bitrate, in which case re-encoding would only lose quality.
 */
export function planStream(
	source: PlanSource,
	requested: AudioQuality,
	max: AudioQuality,
	caps: Set<CodecKey>,
	bitrates: { max?: number; high: number; normal: number; low: number },
	policy: TranscodePolicy = DEFAULT_POLICY,
): StreamPlan {
	let profile = capProfile(requested, max);
	if (profile === 'lossless' && !policy.allowLossless) profile = 'original';
	const playable = isPlayable(source.codec, caps);
	const flac = (): StreamPlan => ({
		mode: 'transcode',
		profile: 'lossless',
		target: {
			codec: 'flac',
			ext: 'flac',
			sampleRate: flacRate(source),
			bitDepth: source.codec === 'dsd' ? 24 : undefined,
		},
	});
	if (profile === 'original' || profile === 'lossless') {
		if (playable) return { mode: 'original', profile };
		// Hi-res rule: with FLAC allowed, hi-res sources stay lossless at their
		// native rate (DSD → 176.4/352.8k) instead of dropping to 48k lossy.
		if (profile === 'lossless' || (policy.allowLossless && isHiRes(source))) return flac();
		if (policy.fallback === 'lossless') return flac();
		// One cached copy every browser (incl. Safari) plays: AAC or MP3, not Opus.
		return lossyPlan(source, policy.fallback, bitrates, policy.maxFormat, false);
	}
	const kbps = profile === 'max' ? (bitrates.max ?? 320) : bitrates[profile];
	const srcKbps = source.bitrate ? Math.round(source.bitrate / 1000) : null;
	if (playable && srcKbps != null && srcKbps <= kbps + 8) return { mode: 'original', profile };
	return lossyPlan(source, profile, bitrates, policy.maxFormat, caps.has('opus'));
}

function lossyPlan(
	source: PlanSource,
	profile: Exclude<AudioQuality, 'original' | 'lossless'>,
	bitrates: { max?: number; high: number; normal: number; low: number },
	maxFormat: MaxFormat,
	opus: boolean,
): StreamPlan {
	if (profile === 'max') {
		if (maxFormat === 'mp3-v0') {
			return {
				mode: 'transcode',
				profile,
				target: {
					codec: 'mp3',
					vbrQuality: 0,
					ext: 'mp3',
					sampleRate: lossyRate(source.sampleRate, 'mp3'),
				},
			};
		}
		// Max is AAC even for Opus clients: Opus is transparent far below 320k.
		return {
			mode: 'transcode',
			profile,
			target: {
				codec: 'aac',
				bitrateKbps: bitrates.max ?? 320,
				ext: 'm4a',
				sampleRate: lossyRate(source.sampleRate, 'aac'),
			},
		};
	}
	const kbps = bitrates[profile];
	return {
		mode: 'transcode',
		profile,
		target: opus
			? { codec: 'opus', bitrateKbps: kbps, ext: 'opus', sampleRate: 48_000 }
			: {
					codec: 'aac',
					bitrateKbps: kbps,
					ext: 'm4a',
					sampleRate: lossyRate(source.sampleRate, 'aac'),
				},
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

import { describe, expect, it } from 'vitest';
import {
	cacheName,
	capProfile,
	codecKey,
	flacRate,
	lossyRate,
	parseCaps,
	planStream,
} from '../playability.js';

const B = { high: 256, normal: 160, low: 96 };

describe('codecKey', () => {
	it('maps music-metadata codec strings', () => {
		expect(codecKey('MPEG 1 Layer 3')).toBe('mp3');
		expect(codecKey('ALAC')).toBe('alac');
		expect(codecKey('AAC', 'M4A/mp42')).toBe('aac');
		expect(codecKey('FLAC')).toBe('flac');
		expect(codecKey('PCM', 'AIFF')).toBe('aiff');
		expect(codecKey('PCM', 'WAVE')).toBe('pcm');
		expect(codecKey("Monkey's Audio")).toBe('ape');
	});
});

describe('planStream', () => {
	const chrome = parseCaps('opus,vorbis');
	it('sends FLAC untouched at original quality', () => {
		expect(
			planStream({ codec: 'flac', bitrate: 900_000 }, 'original', 'original', chrome, B),
		).toEqual({
			mode: 'original',
			profile: 'original',
		});
	});
	it('transcodes unplayable sources to lossy AAC at the fallback bitrate by default', () => {
		const p = planStream(
			{ codec: 'aiff', bitrate: 1_411_000 },
			'original',
			'original',
			chrome,
			B,
		);
		expect(p).toMatchObject({
			mode: 'transcode',
			profile: 'high',
			target: { codec: 'aac', bitrateKbps: 256, ext: 'm4a' },
		});
	});
	it('uses FLAC for unplayable sources only when lossless is allowed and chosen', () => {
		const flac = {
			allowLossless: true,
			fallback: 'lossless' as const,
			maxFormat: 'aac' as const,
		};
		expect(
			planStream({ codec: 'alac', bitrate: 900_000 }, 'original', 'original', chrome, B, flac)
				.target?.codec,
		).toBe('flac');
		// Allowed but fallback lossy → still AAC.
		expect(
			planStream({ codec: 'alac', bitrate: 900_000 }, 'original', 'original', chrome, B, {
				allowLossless: true,
				fallback: 'normal',
				maxFormat: 'aac',
			}).target,
		).toMatchObject({ codec: 'aac', bitrateKbps: 160 });
	});
	it('treats a lossless request as original while lossless is off', () => {
		expect(
			planStream({ codec: 'flac', bitrate: 900_000 }, 'lossless', 'original', chrome, B),
		).toEqual({ mode: 'original', profile: 'original' });
		expect(
			planStream({ codec: 'wavpack', bitrate: 900_000 }, 'lossless', 'original', chrome, B)
				.target?.codec,
		).toBe('aac');
	});
	it('keeps FLAC sources as FLAC under original', () => {
		expect(
			planStream({ codec: 'flac', bitrate: 900_000 }, 'original', 'original', chrome, B).mode,
		).toBe('original');
	});
	it('serves ALAC natively when the client reports it (Safari)', () => {
		expect(
			planStream(
				{ codec: 'alac', bitrate: 900_000 },
				'original',
				'original',
				parseCaps('alac'),
				B,
			).mode,
		).toBe('original');
	});
	it('never upscales a low-bitrate source', () => {
		expect(
			planStream({ codec: 'mp3', bitrate: 128_000 }, 'high', 'original', chrome, B).mode,
		).toBe('original');
	});
	it('uses Opus, or AAC without Opus support', () => {
		expect(
			planStream({ codec: 'flac', bitrate: 900_000 }, 'normal', 'original', chrome, B).target,
		).toEqual({ codec: 'opus', bitrateKbps: 160, ext: 'opus', sampleRate: 48_000 });
		expect(
			planStream({ codec: 'flac', bitrate: 900_000 }, 'normal', 'original', parseCaps(''), B)
				.target?.codec,
		).toBe('aac');
	});
	it('applies the admin maximum', () => {
		expect(capProfile('original', 'high')).toBe('high');
		expect(capProfile('low', 'high')).toBe('low');
	});
});

describe('max quality, hi-res rule, sample rates', () => {
	const chrome = parseCaps('opus,vorbis');
	const flacOn = { allowLossless: true, fallback: 'high' as const, maxFormat: 'aac' as const };
	it('max = AAC 320 even for Opus clients; MP3 V0 when chosen', () => {
		const p = planStream({ codec: 'flac', bitrate: 900_000 }, 'max', 'original', chrome, {
			...B,
			max: 320,
		});
		expect(p.target).toMatchObject({ codec: 'aac', bitrateKbps: 320, ext: 'm4a' });
		expect(cacheName(p)).toBe('max-320.m4a');
		const v0 = planStream({ codec: 'flac', bitrate: 900_000 }, 'max', 'original', chrome, B, {
			...flacOn,
			maxFormat: 'mp3-v0',
		});
		expect(v0.target).toMatchObject({ codec: 'mp3', vbrQuality: 0, ext: 'mp3' });
		expect(cacheName(v0)).toBe('max-v0.mp3');
	});
	it('keeps an MP3 320 source untouched under max', () => {
		expect(
			planStream({ codec: 'mp3', bitrate: 320_000 }, 'max', 'original', chrome, {
				...B,
				max: 320,
			}).mode,
		).toBe('original');
	});
	it('hi-res unplayable sources go to FLAC at native rate when FLAC is allowed', () => {
		const p = planStream(
			{ codec: 'aiff', bitrate: 9_216_000, sampleRate: 192_000, bitDepth: 24 },
			'original',
			'original',
			chrome,
			B,
			flacOn,
		);
		expect(p).toMatchObject({
			profile: 'lossless',
			target: { codec: 'flac', sampleRate: null },
		});
		expect(cacheName(p)).toBe('lossless.flac');
		// CD-quality AIFF still gets the small lossy copy.
		expect(
			planStream(
				{ codec: 'aiff', bitrate: 1_411_000, sampleRate: 44_100, bitDepth: 16 },
				'original',
				'original',
				chrome,
				B,
				flacOn,
			).target?.codec,
		).toBe('aac');
		// Without FLAC allowed, hi-res drops to lossy 44.1k (rate family kept).
		const lossy = planStream(
			{ codec: 'aiff', bitrate: 9_216_000, sampleRate: 176_400, bitDepth: 24 },
			'original',
			'original',
			chrome,
			B,
		);
		expect(lossy.target).toMatchObject({ codec: 'aac', sampleRate: 44_100 });
		expect(cacheName(lossy)).toBe('high-256-44100.m4a');
	});
	it('DSD decimates to 176.4k (DSD64) / 352.8k (DSD128+)', () => {
		expect(flacRate({ codec: 'dsd', bitrate: null, sampleRate: 2_822_400 })).toBe(176_400);
		expect(flacRate({ codec: 'dsd', bitrate: null, sampleRate: 5_644_800 })).toBe(352_800);
		expect(flacRate({ codec: 'dsd', bitrate: null, sampleRate: 11_289_600 })).toBe(352_800);
		expect(flacRate({ codec: 'flac', bitrate: null, sampleRate: 384_000 })).toBeNull();
	});
	it('lossy rate keeps the 44.1/48k family and caps at 48k', () => {
		expect(lossyRate(44_100, 'aac')).toBeNull();
		expect(lossyRate(96_000, 'aac')).toBe(48_000);
		expect(lossyRate(352_800, 'mp3')).toBe(44_100);
		expect(lossyRate(44_100, 'opus')).toBe(48_000);
	});
});

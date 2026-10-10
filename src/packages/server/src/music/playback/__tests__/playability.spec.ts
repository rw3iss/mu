import { describe, expect, it } from 'vitest';
import { capProfile, codecKey, parseCaps, planStream } from '../playability.js';

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
	it('transcodes ALAC to FLAC for browsers that lack it', () => {
		expect(
			planStream({ codec: 'alac', bitrate: 900_000 }, 'original', 'original', chrome, B)
				.target?.codec,
		).toBe('flac');
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
		).toEqual({ codec: 'opus', bitrateKbps: 160, ext: 'opus' });
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

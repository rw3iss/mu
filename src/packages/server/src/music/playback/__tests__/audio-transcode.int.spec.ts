import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MUSIC_SETTINGS } from '@mu/shared';
import { describe, expect, it } from 'vitest';
import { AudioTranscodeService } from '../audio-transcode.service.js';
import { planStream } from '../playability.js';

const hasFfmpeg = (() => {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

describe.skipIf(!hasFfmpeg)('AudioTranscodeService (ffmpeg)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'mu-audio-'));
	const src = join(dir, 'tone.flac');
	execFileSync('ffmpeg', [
		'-v',
		'error',
		'-f',
		'lavfi',
		'-i',
		'sine=frequency=440:duration=6',
		'-af',
		'volume=0.5',
		src,
	]);
	const config = {
		get: (k: string, d?: string) => (k === 'transcoding.ffmpegPath' ? (d ?? 'ffmpeg') : dir),
	} as never;
	const settings = { get: () => DEFAULT_MUSIC_SETTINGS } as never;
	const svc = new AudioTranscodeService(config, settings);

	it('builds and caches an Opus profile once', async () => {
		const plan = {
			mode: 'transcode' as const,
			profile: 'normal' as const,
			target: { codec: 'opus' as const, bitrateKbps: 160, ext: 'opus' as const },
		};
		const [a, b] = await Promise.all([svc.build('f1', src, plan), svc.build('f1', src, plan)]);
		expect(a).toBe(b);
		expect(statSync(a).size).toBeGreaterThan(1024);
		expect(svc.cachedPath('f1', plan)).toBe(a);
	});

	it('builds FLAC and AAC targets', async () => {
		const flac = await svc.build('f2', src, {
			mode: 'transcode',
			profile: 'lossless',
			target: { codec: 'flac', ext: 'flac' },
		});
		const aac = await svc.build('f2', src, {
			mode: 'transcode',
			profile: 'low',
			target: { codec: 'aac', bitrateKbps: 96, ext: 'm4a' },
		});
		expect(existsSync(flac) && existsSync(aac)).toBe(true);
	});

	it('produces normalised waveform peaks', async () => {
		const w = await svc.buildWaveform('f3', src, 6);
		expect(w.peaks.length).toBe(300);
		expect(Math.max(...w.peaks)).toBe(1);
		expect(w.peaks.filter((p) => p > 0.5).length).toBeGreaterThan(250);
		expect((await svc.readWaveform('f3'))?.peaks.length).toBe(300);
	});

	const probe = (file: string) =>
		JSON.parse(
			execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {
				encoding: 'utf8',
			}),
		).streams[0] as { codec_name: string; sample_rate: string; bits_per_raw_sample?: string };

	it('hi-res: max AAC / MP3 V0 resample to 48k, FLAC keeps the native rate', async () => {
		const hires = join(dir, 'hires.aiff');
		execFileSync('ffmpeg', [
			'-v',
			'error',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=440:duration=4:sample_rate=96000',
			'-c:a',
			'pcm_s24be',
			hires,
		]);
		const src = {
			codec: 'aiff' as const,
			bitrate: 4_608_000,
			sampleRate: 96_000,
			bitDepth: 24,
		};
		const B = { max: 320, high: 192, normal: 128, low: 96 };
		const caps = new Set(['mp3', 'aac', 'flac', 'pcm'] as const) as never;
		const maxAac = planStream(src, 'max', 'original', caps, B);
		const mp3 = planStream(src, 'max', 'original', caps, B, {
			allowLossless: false,
			fallback: 'high',
			maxFormat: 'mp3-v0',
		});
		const flac = planStream(src, 'original', 'original', caps, B, {
			allowLossless: true,
			fallback: 'high',
			maxFormat: 'aac',
		});
		const a = probe(await svc.build('h1', hires, maxAac));
		const m = probe(await svc.build('h1', hires, mp3));
		const f = probe(await svc.build('h1', hires, flac));
		expect([a.codec_name, a.sample_rate]).toEqual(['aac', '48000']);
		expect([m.codec_name, m.sample_rate]).toEqual(['mp3', '48000']);
		expect([f.codec_name, f.sample_rate]).toEqual(['flac', '96000']);
	});
});

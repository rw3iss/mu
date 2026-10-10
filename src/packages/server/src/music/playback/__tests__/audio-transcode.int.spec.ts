import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MUSIC_SETTINGS } from '@mu/shared';
import { describe, expect, it } from 'vitest';
import { AudioTranscodeService } from '../audio-transcode.service.js';

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
	const config = { get: (k: string) => (k === 'cache.dir' ? dir : dir) } as never;
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
});

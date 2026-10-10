import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WaveformData } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import { ConfigService } from '../../config/config.service.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { PeakReducer, waveformBucketCount } from './peaks.js';
import type { StreamPlan } from './playability.js';

/**
 * Builds and caches audio transcodes and waveform peaks.
 * Layout: <cacheRoot>/music/<trackFileId>/<profile>.<ext> and waveform.json.
 * Files are written to `.part` then renamed so a crash never leaves a
 * truncated file that would be served.
 */
@Injectable()
export class AudioTranscodeService {
	private readonly logger = new Logger('AudioTranscode');
	private readonly inFlight = new Map<string, Promise<string>>();
	private active = 0;
	private readonly waiters: (() => void)[] = [];
	/** On-demand builds run at most this many at once. */
	private static readonly MAX_PARALLEL = 2;

	constructor(
		private readonly config: ConfigService,
		private readonly musicSettings: MusicSettingsService,
	) {}

	get cacheRoot(): string {
		const cache = this.config.get<string>('cache.dir') || join(this.config.get<string>('dataDir'), 'cache');
		return join(cache, 'music');
	}

	fileDir(trackFileId: string): string {
		return join(this.cacheRoot, trackFileId);
	}

	cachedPath(trackFileId: string, plan: StreamPlan): string | null {
		if (plan.mode !== 'transcode' || !plan.target) return null;
		const p = join(this.fileDir(trackFileId), `${plan.profile}.${plan.target.ext}`);
		return existsSync(p) ? p : null;
	}

	private async slot<T>(fn: () => Promise<T>): Promise<T> {
		if (this.active >= AudioTranscodeService.MAX_PARALLEL) {
			await new Promise<void>((r) => this.waiters.push(r));
		}
		this.active++;
		try {
			return await fn();
		} finally {
			this.active--;
			this.waiters.shift()?.();
		}
	}

	/** Build (or join an in-flight build of) the transcode for this plan. */
	build(trackFileId: string, srcPath: string, plan: StreamPlan): Promise<string> {
		if (plan.mode !== 'transcode' || !plan.target) return Promise.resolve(srcPath);
		const target = plan.target;
		const out = join(this.fileDir(trackFileId), `${plan.profile}.${target.ext}`);
		if (existsSync(out)) return Promise.resolve(out);
		const existing = this.inFlight.get(out);
		if (existing) return existing;

		const job = this.slot(async () => {
			await mkdir(this.fileDir(trackFileId), { recursive: true });
			const part = `${out}.part`;
			const flacLevel = this.musicSettings.get().flacCompressionLevel;
			await new Promise<void>((resolve, reject) => {
				let cmd = ffmpeg(srcPath).noVideo().outputOptions(['-map', '0:a:0', '-map_metadata', '0']);
				if (target.codec === 'flac') {
					cmd = cmd
						.audioCodec('flac')
						.outputOptions(['-compression_level', String(flacLevel)])
						// DSD → 24-bit PCM at 88.2 kHz (DSD64's natural decimation).
						.outputOptions(/dsf|dff$/i.test(srcPath) ? ['-ar', '88200', '-sample_fmt', 's32'] : [])
						.format('flac');
				} else if (target.codec === 'opus') {
					cmd = cmd
						.audioCodec('libopus')
						.audioBitrate(`${target.bitrateKbps}k`)
						.outputOptions(['-vbr', 'on', '-ac', '2'])
						.format('ogg');
				} else {
					cmd = cmd
						.audioCodec('aac')
						.audioBitrate(`${target.bitrateKbps}k`)
						.outputOptions(['-ac', '2', '-movflags', '+faststart'])
						.format('mp4');
				}
				cmd.output(part).on('end', () => resolve()).on('error', reject).run();
			});
			if (statSync(part).size < 1024) {
				await rm(part, { force: true });
				throw new Error('transcode produced an empty file');
			}
			await rename(part, out);
			return out;
		}).finally(() => this.inFlight.delete(out));

		this.inFlight.set(out, job);
		return job;
	}

	waveformPath(trackFileId: string): string {
		return join(this.fileDir(trackFileId), 'waveform.json');
	}

	async readWaveform(trackFileId: string): Promise<WaveformData | null> {
		try {
			return JSON.parse(await readFile(this.waveformPath(trackFileId), 'utf8')) as WaveformData;
		} catch {
			return null;
		}
	}

	/** Decode to 4 kHz mono PCM and reduce to peaks; cached as JSON. */
	async buildWaveform(trackFileId: string, srcPath: string, durationSeconds: number): Promise<WaveformData> {
		const out = this.waveformPath(trackFileId);
		const cached = await this.readWaveform(trackFileId);
		if (cached) return cached;
		const SAMPLE_RATE = 4000;
		const buckets = waveformBucketCount(durationSeconds);
		const samplesPerBucket = Math.max(1, Math.ceil((durationSeconds * SAMPLE_RATE) / buckets));
		const reducer = new PeakReducer(buckets, samplesPerBucket);

		await this.slot(
			() =>
				new Promise<void>((resolve, reject) => {
					const stream = ffmpeg(srcPath)
						.noVideo()
						.audioChannels(1)
						.audioFrequency(SAMPLE_RATE)
						.format('s16le')
						.on('error', reject)
						.pipe();
					stream.on('data', (chunk: Buffer) => reducer.push(chunk));
					stream.on('end', () => resolve());
					stream.on('error', reject);
				}),
		);

		const data: WaveformData = {
			trackFileId,
			samplesPerSecond: buckets / durationSeconds,
			peaks: reducer.finish(),
		};
		await mkdir(this.fileDir(trackFileId), { recursive: true });
		await writeFile(`${out}.part`, JSON.stringify(data));
		await rename(`${out}.part`, out);
		return data;
	}

	/** Total bytes of transcodes (excluding waveforms) — for the LRU cap. */
	async evict(maxBytes: number, keep: (trackFileId: string, file: string) => boolean): Promise<number> {
		const entries: { path: string; size: number; atime: number; fileId: string; name: string }[] = [];
		let dirs: string[] = [];
		try {
			dirs = await readdir(this.cacheRoot);
		} catch {
			return 0;
		}
		for (const fileId of dirs) {
			let names: string[] = [];
			try {
				names = await readdir(join(this.cacheRoot, fileId));
			} catch {
				continue;
			}
			for (const name of names) {
				if (name === 'waveform.json' || name.endsWith('.part')) continue;
				const p = join(this.cacheRoot, fileId, name);
				const s = await stat(p).catch(() => null);
				if (s) entries.push({ path: p, size: s.size, atime: s.atimeMs, fileId, name });
			}
		}
		let total = entries.reduce((n, e) => n + e.size, 0);
		let removed = 0;
		for (const e of entries.sort((a, b) => a.atime - b.atime)) {
			if (total <= maxBytes) break;
			if (keep(e.fileId, e.name)) continue;
			await rm(e.path, { force: true });
			total -= e.size;
			removed++;
		}
		if (removed) this.logger.log(`Evicted ${removed} cached transcode(s)`);
		return removed;
	}
}

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JOB_TYPE, LibraryJobsService } from './library-jobs.service.js';

const TICK_MS = 5 * 60 * 1000; // re-evaluate the window every 5 minutes

interface SweepConfig {
	enabled: boolean;
	/** Local time of day to start, "HH:MM". */
	startTime: string;
	/** How long the window stays open, in hours. */
	durationHours: number;
}

/**
 * Runs the library-wide MP4 conversion sweep inside an admin-defined daily
 * window instead of grinding 24/7 (which saturates the media HDD and stutters
 * playback). On entering the window it enqueues conversion jobs; on leaving it
 * cancels any still pending/running so the disk is free for viewers.
 *
 * Config lives in the `encoding` settings blob under `convertSweep`
 * (enabled / startTime / durationHours), edited from Settings → Encoding.
 */
@Injectable()
export class ConvertSweepService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger('ConvertSweepService');
	private timer: ReturnType<typeof setInterval> | null = null;
	private inWindow = false;

	constructor(
		private readonly jobs: JobManagerService,
		private readonly settings: SettingsService,
		private readonly libraryJobs: LibraryJobsService,
	) {}

	onModuleInit(): void {
		// Evaluate once shortly after boot, then on a steady interval.
		this.timer = setInterval(() => this.tick(), TICK_MS);
		setTimeout(() => this.tick(), 15_000);
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	private config(): SweepConfig {
		const enc = this.settings.get<Record<string, unknown>>('encoding', {}) as any;
		const s = (enc?.convertSweep ?? {}) as Record<string, unknown>;
		return {
			enabled: s.enabled === true,
			startTime: typeof s.startTime === 'string' ? s.startTime : '02:00',
			durationHours: Number.isFinite(s.durationHours as number)
				? (s.durationHours as number)
				: 4,
		};
	}

	private tick(): void {
		try {
			const cfg = this.config();
			if (!cfg.enabled) {
				this.inWindow = false;
				return;
			}
			const now = this.isWithinWindow(cfg);
			if (now && !this.inWindow) {
				this.inWindow = true;
				const queued = this.libraryJobs.enqueueConvertJobs();
				this.logger.log(`Convert window opened — queued ${queued} conversion job(s)`);
			} else if (!now && this.inWindow) {
				this.inWindow = false;
				const cancelled = this.cancelConvertJobs();
				this.logger.log(`Convert window closed — cancelled ${cancelled} in-flight job(s)`);
			}
		} catch (err) {
			this.logger.warn(`Convert sweep tick failed: ${(err as Error).message}`);
		}
	}

	/** True when the current local time falls inside [start, start+duration). */
	private isWithinWindow(cfg: SweepConfig): boolean {
		const m = /^(\d{1,2}):(\d{2})$/.exec(cfg.startTime.trim());
		if (!m) return false;
		const startMin = Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
		const lenMin = Math.max(0, cfg.durationHours) * 60;
		if (lenMin <= 0) return false;
		const now = new Date();
		const nowMin = now.getHours() * 60 + now.getMinutes();
		const endMin = startMin + lenMin;
		if (endMin <= 24 * 60) {
			return nowMin >= startMin && nowMin < endMin;
		}
		// Window wraps past midnight.
		return nowMin >= startMin || nowMin < endMin - 24 * 60;
	}

	/** Cancel pending + running MP4 conversion jobs (frees the disk). */
	private cancelConvertJobs(): number {
		let cancelled = 0;
		for (const job of this.jobs.listJobs({ type: JOB_TYPE.CONVERT_MP4 })) {
			if (
				(job.status === 'pending' || job.status === 'running') &&
				this.jobs.cancel(job.id)
			) {
				cancelled++;
			}
		}
		return cancelled;
	}
}

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger('Scheduler');
	private readonly scheduler = new ToadScheduler();
	private readonly jobs = new Map<string, SimpleIntervalJob>();

	onModuleInit() {
		this.logger.log('Scheduler initialized');
	}

	registerJob(name: string, intervalMs: number, handler: () => Promise<void>) {
		if (this.jobs.has(name)) {
			this.logger.warn(`Job "${name}" already registered — removing previous`);
			this.removeJob(name);
		}

		const task = new AsyncTask(
			name,
			async () => {
				this.logger.debug(`Running job: ${name}`);
				await handler();
			},
			(err) => {
				this.logger.error(`Job "${name}" failed: ${err.message}`);
			},
		);

		const job = new SimpleIntervalJob(
			{ milliseconds: intervalMs, runImmediately: false },
			task,
			{ id: name },
		);

		this.scheduler.addSimpleIntervalJob(job);
		this.jobs.set(name, job);
		this.logger.log(`Job "${name}" registered (interval: ${intervalMs}ms)`);
	}

	removeJob(name: string) {
		if (this.jobs.has(name)) {
			this.scheduler.removeById(name);
			this.jobs.delete(name);
			this.logger.log(`Job "${name}" removed`);
		}
	}

	getJobStatus(): string[] {
		return Array.from(this.jobs.keys());
	}

	onModuleDestroy() {
		this.scheduler.stop();
		this.jobs.clear();
		this.logger.log('Scheduler stopped — all jobs cleared');
	}
}

import { type FactoryProvider, Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { InMemoryJobProvider } from './in-memory-job-provider.js';
import { JobController } from './job.controller.js';
import { JobManagerService } from './job-manager.service.js';

/**
 * The `JobManagerService` symbol is provided via a factory that
 * picks a backend based on `jobs.backend` config:
 *
 *   - `'in-memory'` (default) → InMemoryJobProvider
 *   - `'bullmq'`              → BullMqJobProvider (Redis required)
 *
 * BullMQ is loaded dynamically — the module / dependency cost is
 * only paid when the user actively opts in. The in-memory provider
 * has zero new deps.
 *
 * `@Global()` is preserved so callers continue to inject
 * `JobManagerService` without importing this module.
 */
const jobManagerProvider: FactoryProvider = {
	provide: JobManagerService,
	useFactory: async (
		config: ConfigService,
		events: EventsService,
		settings: SettingsService,
		database: DatabaseService,
	): Promise<JobManagerService> => {
		const logger = new Logger('JobModule');
		const backend = (
			config.get<string>('jobs.backend', 'in-memory') || 'in-memory'
		).toLowerCase();

		if (backend === 'bullmq') {
			try {
				const redisUrl = config.get<string>('jobs.redis.url', 'redis://localhost:6379');
				const queueName = config.get<string>('jobs.bullmq.queueName', 'mu-jobs');
				const concurrency = config.get<number>('jobs.bullmq.concurrency', 2);
				const { BullMqJobProvider } = await import('./bullmq-job-provider.js');
				const impl = new BullMqJobProvider(events, settings, database, {
					redisUrl,
					queueName,
					concurrency,
				});
				await impl.initialize();
				logger.log(`Job backend: BullMQ (queue=${queueName}, redis=${redisUrl})`);
				return impl;
			} catch (err: any) {
				logger.error(
					`Failed to initialise BullMQ backend: ${err?.message ?? err}. Falling back to in-memory.`,
				);
			}
		}

		logger.log('Job backend: in-memory (default)');
		return new InMemoryJobProvider(events, settings, database);
	},
	inject: [ConfigService, EventsService, SettingsService, DatabaseService],
};

@Global()
@Module({
	controllers: [JobController],
	providers: [jobManagerProvider],
	exports: [JobManagerService],
})
export class JobModule {}

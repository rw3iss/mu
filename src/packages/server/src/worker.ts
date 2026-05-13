/**
 * Standalone worker entrypoint. Boots a headless NestJS application
 * context (no HTTP listener) so handlers + DI graph are identical to
 * the main server, then idles while the BullMQ worker inside
 * `BullMqJobProvider` pulls jobs from the shared queue.
 *
 * Run alongside the main server for horizontal scaling:
 *
 *     # one shell
 *     node packages/server/dist/main.js
 *
 *     # another shell (or another machine) — same config.yml / env
 *     node packages/server/dist/worker.js
 *
 * Requires `jobs.backend: bullmq` in config — falls back to in-memory
 * otherwise (and warns, because in that mode the worker process is
 * pointless: it pulls from its own private queue).
 */
import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

for (const envPath of [
	resolve(import.meta.dirname, '..', '..', '..', '.env'),
	resolve(import.meta.dirname, '..', '..', '..', '..', '.env'),
	resolve(import.meta.dirname, '..', '.env'),
]) {
	if (existsSync(envPath)) {
		const lines = readFileSync(envPath, 'utf-8').split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx < 1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			let val = trimmed.slice(eqIdx + 1).trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			if (!(key in process.env)) process.env[key] = val;
		}
		break;
	}
}

async function bootstrapWorker() {
	const logger = new Logger('Worker');
	const app = await NestFactory.createApplicationContext(AppModule, {
		bufferLogs: false,
	});

	const config = app.get(ConfigService);
	const backend = (config.get<string>('jobs.backend', 'in-memory') || 'in-memory').toLowerCase();
	if (backend !== 'bullmq') {
		logger.warn(
			'Worker process started but jobs.backend is NOT bullmq — this worker has its own in-memory queue and will not pull from anywhere shared. Set jobs.backend: bullmq in config.yml to enable distributed workers.',
		);
	} else {
		logger.log('Worker started — listening for BullMQ jobs');
	}

	const shutdown = async (signal: string) => {
		logger.log(`Received ${signal}, shutting down…`);
		try {
			await app.close();
		} catch (err: any) {
			logger.warn(`Shutdown error: ${err?.message ?? err}`);
		}
		process.exit(0);
	};
	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrapWorker().catch((err) => {
	// eslint-disable-next-line no-console
	console.error('Worker bootstrap failed:', err);
	process.exit(1);
});

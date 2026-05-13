import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
	providerEvents,
	type ProviderEvent,
	type ProviderEventType,
} from '../database/schema/index.js';

export interface ProviderEventInput {
	providerId: string;
	type: ProviderEventType;
	statusCode?: number | null;
	durationMs?: number | null;
	costUsd?: number | null;
	/** Anything you want preserved; will be JSON-stringified. Redact secrets first. */
	payload?: unknown;
}

/**
 * Append-only audit log for provider activity. Backs sparklines and
 * the admin dashboard "Providers" tab. Writes are best-effort — if
 * the DB is briefly unavailable the in-flight provider call should
 * not fail because of a missing audit row.
 */
@Injectable()
export class ProviderEventsService {
	private readonly logger = new Logger('ProviderEventsService');

	constructor(private readonly database: DatabaseService) {}

	record(input: ProviderEventInput): void {
		try {
			this.database.db
				.insert(providerEvents)
				.values({
					id: crypto.randomUUID(),
					providerId: input.providerId,
					eventType: input.type,
					statusCode: input.statusCode ?? null,
					durationMs: input.durationMs ?? null,
					costUsd: input.costUsd ?? null,
					payload: input.payload != null ? JSON.stringify(input.payload) : null,
					occurredAt: nowISO(),
				})
				.run();
		} catch (err: any) {
			this.logger.warn(`Failed to record provider event: ${err.message}`);
		}
	}

	recent(providerId: string, limit = 50): ProviderEvent[] {
		return this.database.db
			.select()
			.from(providerEvents)
			.where(eq(providerEvents.providerId, providerId))
			.orderBy(desc(providerEvents.occurredAt))
			.limit(limit)
			.all();
	}

	/** Per-day call / error counts for the last N days. */
	dailySummary(
		providerId: string,
		days = 7,
	): {
		date: string;
		calls: number;
		errors: number;
		avgLatency: number | null;
		costUsd: number;
	}[] {
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
		const rows = this.database.db
			.select({
				eventType: providerEvents.eventType,
				occurredAt: providerEvents.occurredAt,
				durationMs: providerEvents.durationMs,
				costUsd: providerEvents.costUsd,
			})
			.from(providerEvents)
			.where(
				and(
					eq(providerEvents.providerId, providerId),
					gte(providerEvents.occurredAt, cutoff),
				),
			)
			.all();

		const map = new Map<
			string,
			{ calls: number; errors: number; latencies: number[]; costUsd: number }
		>();
		for (const r of rows) {
			const date = r.occurredAt.slice(0, 10);
			const entry =
				map.get(date) ?? { calls: 0, errors: 0, latencies: [] as number[], costUsd: 0 };
			if (r.eventType === 'call') entry.calls++;
			if (r.eventType === 'error') entry.errors++;
			if (r.durationMs != null) entry.latencies.push(r.durationMs);
			entry.costUsd += r.costUsd ?? 0;
			map.set(date, entry);
		}

		const out: {
			date: string;
			calls: number;
			errors: number;
			avgLatency: number | null;
			costUsd: number;
		}[] = [];
		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
			const e = map.get(d);
			if (!e) {
				out.push({ date: d, calls: 0, errors: 0, avgLatency: null, costUsd: 0 });
			} else {
				const avgLatency =
					e.latencies.length > 0
						? Math.round(e.latencies.reduce((a, b) => a + b, 0) / e.latencies.length)
						: null;
				out.push({
					date: d,
					calls: e.calls,
					errors: e.errors,
					avgLatency,
					costUsd: Math.round(e.costUsd * 10000) / 10000,
				});
			}
		}
		return out;
	}

	/** Prune events older than the cutoff. Called by a scheduled job (Phase 2+). */
	pruneOlderThan(isoCutoff: string): number {
		const result = this.database.db
			.delete(providerEvents)
			.where(sql`${providerEvents.occurredAt} < ${isoCutoff}`)
			.run();
		return result.changes;
	}
}

import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderEventsService } from '../provider-events.service.js';
import { makeFakeDatabaseService, makeTestDb } from './test-db.js';

describe('ProviderEventsService', () => {
	let service: ProviderEventsService;
	beforeEach(() => {
		const { db } = makeTestDb();
		service = new ProviderEventsService(makeFakeDatabaseService(db));
	});

	it('records and retrieves events in reverse-chronological order', async () => {
		service.record({ providerId: 'tmdb', type: 'call', statusCode: 200, durationMs: 32 });
		// Small wait so occurredAt timestamps differ — use a busy loop since
		// vitest fake timers aren't engaged here.
		const t = Date.now();
		while (Date.now() - t < 5) {}
		service.record({ providerId: 'tmdb', type: 'error', statusCode: 500 });
		const recent = service.recent('tmdb', 10);
		expect(recent).toHaveLength(2);
		expect(recent[0]!.eventType).toBe('error');
		expect(recent[1]!.eventType).toBe('call');
	});

	it('isolates events per provider', () => {
		service.record({ providerId: 'tmdb', type: 'call' });
		service.record({ providerId: 'trakt', type: 'call' });
		expect(service.recent('tmdb')).toHaveLength(1);
		expect(service.recent('trakt')).toHaveLength(1);
	});

	it('redacts nothing — callers must pre-redact payloads', () => {
		// Documents the contract: callers are responsible for redaction.
		service.record({
			providerId: 'p',
			type: 'call',
			payload: { input: 'visible' },
		});
		const r = service.recent('p')[0]!;
		expect(r.payload).toContain('visible');
	});

	it('dailySummary returns N-day zero-filled summary', () => {
		service.record({ providerId: 'p', type: 'call', durationMs: 100 });
		service.record({ providerId: 'p', type: 'call', durationMs: 200 });
		service.record({ providerId: 'p', type: 'error' });
		const sum = service.dailySummary('p', 3);
		expect(sum).toHaveLength(3);
		const today = sum[sum.length - 1]!;
		expect(today.calls).toBe(2);
		expect(today.errors).toBe(1);
		expect(today.avgLatency).toBe(150);
	});

	it('pruneOlderThan removes ancient events', () => {
		service.record({ providerId: 'p', type: 'call' });
		const future = new Date(Date.now() + 60_000).toISOString();
		const removed = service.pruneOlderThan(future);
		expect(removed).toBe(1);
		expect(service.recent('p')).toHaveLength(0);
	});
});

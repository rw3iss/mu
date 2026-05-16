import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetExhausted, RateLimitExceeded } from '../exceptions.js';
import type { Provider, RateLimitSpec } from '../provider.interface.js';
import { ProviderRegistry } from '../provider-registry.service.js';
import { RateLimitService } from '../rate-limit.service.js';
import { makeFakeDatabaseService, makeTestDb } from './test-db.js';

function provider(id: string, rateLimit: RateLimitSpec): Provider {
	return {
		id,
		displayName: id,
		capabilities: new Set(['recommend']),
		auth: 'none',
		configFields: [],
		rateLimit,
		isConfigured: () => true,
		healthCheck: async () => ({ ok: true, checkedAt: new Date().toISOString() }),
	};
}

describe('RateLimitService', () => {
	let registry: ProviderRegistry;
	let service: RateLimitService;
	beforeEach(() => {
		const { db } = makeTestDb();
		registry = new ProviderRegistry();
		service = new RateLimitService(makeFakeDatabaseService(db), registry);
	});

	it('is a no-op for unknown providers', async () => {
		await expect(service.acquire('unknown')).resolves.toBeUndefined();
		expect(() => service.record('unknown')).not.toThrow();
	});

	it('passes when under perSecond limit', async () => {
		registry.register(provider('p', { perSecond: 3 }));
		await service.acquire('p');
		service.record('p');
		await service.acquire('p');
		service.record('p');
		await service.acquire('p');
		service.record('p');
		expect(service.snapshot('p').second).toBe(3);
	});

	it('throws RateLimitExceeded on perSecond overflow', async () => {
		registry.register(provider('p', { perSecond: 2 }));
		service.record('p');
		service.record('p');
		await expect(service.acquire('p')).rejects.toBeInstanceOf(RateLimitExceeded);
	});

	it('throws RateLimitExceeded on perDay overflow', async () => {
		registry.register(provider('p', { perDay: 1 }));
		service.record('p');
		await expect(service.acquire('p')).rejects.toBeInstanceOf(RateLimitExceeded);
	});

	it('throws BudgetExhausted when projected spend exceeds ceiling', async () => {
		registry.register(provider('p', { costPerCall: 0.01, monthlyBudgetUsd: 0.025 }));
		service.record('p'); // 0.01
		service.record('p'); // 0.02
		// projected next: 0.03 > 0.025
		await expect(service.acquire('p')).rejects.toBeInstanceOf(BudgetExhausted);
	});

	it('records actual cost when provided', () => {
		registry.register(provider('p', { costPerCall: 0.01, monthlyBudgetUsd: 100 }));
		service.record('p', 1, 0.123);
		expect(service.snapshot('p').monthCost).toBeCloseTo(0.123, 4);
	});

	it('day/month buckets persist (snapshot reads from DB)', () => {
		registry.register(provider('p', { perDay: 100 }));
		service.record('p', 1);
		service.record('p', 1);
		service.record('p', 1);
		expect(service.snapshot('p').day).toBe(3);
		expect(service.snapshot('p').month).toBe(3);
	});

	it('survives a service restart (snapshot from DB even after re-instantiation)', async () => {
		const { db } = makeTestDb();
		const reg = new ProviderRegistry();
		reg.register(provider('p', { perDay: 100 }));
		const fakeDb = makeFakeDatabaseService(db);

		const s1 = new RateLimitService(fakeDb, reg);
		s1.record('p');
		s1.record('p');
		expect(s1.snapshot('p').day).toBe(2);

		// "Restart" — same DB, new service instance
		const s2 = new RateLimitService(fakeDb, reg);
		expect(s2.snapshot('p').day).toBe(2);
		// Per-second in-memory bucket is fresh after restart
		expect(s2.snapshot('p').second).toBe(0);
	});

	it('dailyHistory returns N days zero-filled', () => {
		registry.register(provider('p', { perDay: 100 }));
		service.record('p', 1);
		const hist = service.dailyHistory('p', 3);
		expect(hist).toHaveLength(3);
		expect(hist[hist.length - 1]!.count).toBe(1);
	});

	it('per-second window resets after 1s (uses fake timers)', async () => {
		vi.useFakeTimers();
		try {
			registry.register(provider('p', { perSecond: 1 }));
			service.record('p');
			await expect(service.acquire('p')).rejects.toBeInstanceOf(RateLimitExceeded);
			vi.advanceTimersByTime(1100);
			await expect(service.acquire('p')).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});

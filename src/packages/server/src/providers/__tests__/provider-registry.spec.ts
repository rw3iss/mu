import { beforeEach, describe, expect, it } from 'vitest';
import type { Provider } from '../provider.interface.js';
import { ProviderRegistry } from '../provider-registry.service.js';

function fakeProvider(over: Partial<Provider> & Pick<Provider, 'id'>): Provider {
	return {
		id: over.id,
		displayName: over.displayName ?? over.id,
		description: over.description,
		capabilities: over.capabilities ?? new Set(['recommend']),
		auth: over.auth ?? 'none',
		configFields: over.configFields ?? [],
		rateLimit: over.rateLimit ?? {},
		isConfigured: over.isConfigured ?? (() => true),
		healthCheck:
			over.healthCheck ?? (async () => ({ ok: true, checkedAt: new Date().toISOString() })),
	};
}

describe('ProviderRegistry', () => {
	let reg: ProviderRegistry;
	beforeEach(() => {
		reg = new ProviderRegistry();
	});

	it('registers and looks up providers by id', () => {
		const p = fakeProvider({ id: 'tmdb' });
		reg.register(p);
		expect(reg.get('tmdb')).toBe(p);
		expect(reg.has('tmdb')).toBe(true);
		expect(reg.size()).toBe(1);
	});

	it('returns null for unknown id', () => {
		expect(reg.get('nope')).toBeNull();
		expect(reg.has('nope')).toBe(false);
	});

	it('filters by capability', () => {
		reg.register(fakeProvider({ id: 'tmdb', capabilities: new Set(['recommend']) }));
		reg.register(fakeProvider({ id: 'minilm', capabilities: new Set(['embed']) }));
		reg.register(
			fakeProvider({
				id: 'claude',
				capabilities: new Set(['rerank', 'explain']),
			}),
		);
		expect(reg.list('recommend').map((p) => p.id)).toEqual(['tmdb']);
		expect(reg.list('embed').map((p) => p.id)).toEqual(['minilm']);
		expect(reg.list('rerank').map((p) => p.id)).toEqual(['claude']);
		expect(reg.list().length).toBe(3);
	});

	it('configured() further filters by isConfigured', () => {
		reg.register(fakeProvider({ id: 'tmdb', isConfigured: () => true }));
		reg.register(fakeProvider({ id: 'trakt', isConfigured: () => false }));
		const ids = reg.configured('recommend').map((p) => p.id);
		expect(ids).toEqual(['tmdb']);
	});

	it('replaces on duplicate registration', () => {
		const first = fakeProvider({ id: 'tmdb', displayName: 'TMDB' });
		const second = fakeProvider({ id: 'tmdb', displayName: 'TMDB v2' });
		reg.register(first);
		reg.register(second);
		expect(reg.size()).toBe(1);
		expect(reg.get('tmdb')?.displayName).toBe('TMDB v2');
	});

	it('unregisters', () => {
		reg.register(fakeProvider({ id: 'tmdb' }));
		expect(reg.unregister('tmdb')).toBe(true);
		expect(reg.unregister('tmdb')).toBe(false);
		expect(reg.size()).toBe(0);
	});
});

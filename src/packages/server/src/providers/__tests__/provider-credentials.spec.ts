import { beforeEach, describe, expect, it } from 'vitest';
import type { ConfigFieldSpec } from '../provider.interface.js';
import {
	isMaskedSecret,
	maskSecret,
	ProviderCredentialsService,
} from '../provider-credentials.service.js';
import { makeFakeDatabaseService, makeTestDb } from './test-db.js';

const FIELDS: ConfigFieldSpec[] = [
	{ key: 'clientId', label: 'Client ID', type: 'string' },
	{ key: 'clientSecret', label: 'Client Secret', type: 'secret' },
];

describe('ProviderCredentialsService', () => {
	let service: ProviderCredentialsService;
	beforeEach(() => {
		const { db } = makeTestDb();
		service = new ProviderCredentialsService(makeFakeDatabaseService(db));
	});

	it('returns null until configured', () => {
		expect(service.getRaw('trakt')).toBeNull();
		expect(service.isConfigured('trakt')).toBe(false);
	});

	it('upserts and round-trips the config', () => {
		service.upsert('trakt', { clientId: 'abc', clientSecret: 'super-secret-value' }, FIELDS);
		expect(service.isConfigured('trakt')).toBe(true);
		expect(service.getRaw('trakt')).toEqual({
			clientId: 'abc',
			clientSecret: 'super-secret-value',
		});
	});

	it('masks secret fields on getMasked', () => {
		service.upsert('trakt', { clientId: 'abc', clientSecret: 'super-secret-value' }, FIELDS);
		const masked = service.getMasked('trakt', FIELDS);
		expect(masked?.clientId).toBe('abc');
		expect(masked?.clientSecret).toMatch(/••••/);
		expect(masked?.clientSecret).not.toContain('super');
	});

	it('preserves existing secret when masked value is re-submitted', () => {
		service.upsert('trakt', { clientId: 'abc', clientSecret: 'originalsecret123' }, FIELDS);
		const masked = service.getMasked('trakt', FIELDS) as Record<string, string>;
		// Simulate the UI sending the masked value back unchanged
		service.upsert('trakt', { clientId: 'abc-2', clientSecret: masked.clientSecret }, FIELDS);
		expect(service.getRaw('trakt')).toEqual({
			clientId: 'abc-2',
			clientSecret: 'originalsecret123',
		});
	});

	it('setEnabled toggles the row', () => {
		service.upsert('trakt', { clientId: 'abc', clientSecret: 'x' }, FIELDS);
		expect(service.isConfigured('trakt')).toBe(true);
		expect(service.setEnabled('trakt', false)).toBe(true);
		expect(service.isConfigured('trakt')).toBe(false);
		service.setEnabled('trakt', true);
		expect(service.isConfigured('trakt')).toBe(true);
	});

	it('delete removes the row', () => {
		service.upsert('trakt', { clientId: 'abc', clientSecret: 'x' }, FIELDS);
		expect(service.delete('trakt')).toBe(true);
		expect(service.isConfigured('trakt')).toBe(false);
		expect(service.delete('trakt')).toBe(false);
	});
});

describe('maskSecret / isMaskedSecret', () => {
	it('masks long secrets with first/last 4 visible', () => {
		expect(maskSecret('sk_test_1234567890abcdef')).toBe('sk_t••••cdef');
	});
	it('blanket masks short secrets', () => {
		expect(maskSecret('short')).toBe('••••••••');
	});
	it('isMaskedSecret detects the mask pattern', () => {
		expect(isMaskedSecret(maskSecret('abc1234567890def'))).toBe(true);
		expect(isMaskedSecret('plaintext')).toBe(false);
	});
});

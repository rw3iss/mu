import { describe, expect, it } from 'vitest';
import { deriveOfflineKey, signOfflineToken, verifyOfflineToken } from '../offline-token.js';

const key = deriveOfflineKey('a'.repeat(48));
const payload = { f: 'file-1', p: 'high', c: 'flac,opus', u: 'user-1', e: Date.now() + 60_000 };

describe('offline download tokens', () => {
	it('round-trips a valid token', () => {
		const t = signOfflineToken(key, payload);
		expect(verifyOfflineToken(key, t)).toEqual(payload);
	});

	it('rejects expired tokens', () => {
		const t = signOfflineToken(key, { ...payload, e: Date.now() - 1 });
		expect(verifyOfflineToken(key, t)).toBeNull();
		const live = signOfflineToken(key, payload);
		expect(verifyOfflineToken(key, live, payload.e + 1)).toBeNull();
	});

	it('rejects tampered payloads and foreign keys', () => {
		const t = signOfflineToken(key, payload);
		const [, sig] = t.split('.');
		const forged = `${Buffer.from(JSON.stringify({ ...payload, f: 'file-2' })).toString('base64url')}.${sig}`;
		expect(verifyOfflineToken(key, forged)).toBeNull();
		expect(verifyOfflineToken(deriveOfflineKey('b'.repeat(48)), t)).toBeNull();
	});

	it('rejects malformed input', () => {
		for (const bad of [undefined, null, '', 'abc', 'a.b.c', '.sig', 'x'.repeat(3000)]) {
			expect(verifyOfflineToken(key, bad as string)).toBeNull();
		}
	});

	it('derives a key distinct from the raw secret', () => {
		expect(deriveOfflineKey('s'.repeat(40)).equals(Buffer.from('s'.repeat(40)))).toBe(false);
	});
});

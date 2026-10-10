import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed tokens for offline music downloads. A cached download
 * Request must not carry the user's JWT, so the file URL carries a token
 * bound to one track file + profile + capability list + user, valid for a few
 * minutes. Format: `<base64url(json payload)>.<base64url(hmac-sha256)>`.
 */
export interface OfflineTokenPayload {
	/** track_files.id */
	f: string;
	/** Profile (AudioQuality) */
	p: string;
	/** Client codec capability list (as sent to the stream planner). */
	c: string;
	/** User id (audit only). */
	u: string;
	/** Expiry, epoch ms. */
	e: number;
}

/** Derive the signing key from the server secret (never use the JWT key directly). */
export function deriveOfflineKey(serverSecret: string): Buffer {
	return createHmac('sha256', serverSecret).update('mu-music-offline-v1').digest();
}

function mac(key: Buffer, body: string): string {
	return createHmac('sha256', key).update(body).digest('base64url');
}

export function signOfflineToken(key: Buffer, payload: OfflineTokenPayload): string {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${body}.${mac(key, body)}`;
}

/** Verify signature + expiry. Returns the payload, or null when invalid/expired. */
export function verifyOfflineToken(
	key: Buffer,
	token: string | undefined | null,
	now = Date.now(),
): OfflineTokenPayload | null {
	if (!token || typeof token !== 'string' || token.length > 2048) return null;
	const dot = token.indexOf('.');
	if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
	const body = token.slice(0, dot);
	const sig = Buffer.from(token.slice(dot + 1), 'base64url');
	const expected = Buffer.from(mac(key, body), 'base64url');
	if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
	let payload: OfflineTokenPayload;
	try {
		payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	if (
		!payload ||
		typeof payload.f !== 'string' ||
		typeof payload.p !== 'string' ||
		typeof payload.c !== 'string' ||
		typeof payload.e !== 'number'
	) {
		return null;
	}
	if (payload.e <= now) return null;
	return payload;
}

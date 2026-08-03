import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';

export interface WsIdentity {
	userId: string;
	role: string;
}

/**
 * Authenticates WebSocket upgrade requests against the same JWT the HTTP API
 * uses (`@fastify/jwt`, HS256, `auth.jwtSecret`). The token is read from the
 * `?token=` query param (sent by the client) or the `mu_access_token` cookie.
 *
 * Verified with Node crypto (no extra dep) since the WS gateway has no Fastify
 * request to call `jwtVerify()` on.
 */
@Injectable()
export class WsAuthService {
	private readonly logger = new Logger('WsAuth');

	constructor(private readonly config: ConfigService) {}

	/**
	 * Whether unauthenticated sockets are rejected + channel-ownership is
	 * enforced. Ops escape hatch (`MU_WS_AUTH_ENFORCE=false`) for a one-release
	 * rollback if an existing consumer breaks; default ON.
	 */
	get enforce(): boolean {
		const v = process.env.MU_WS_AUTH_ENFORCE;
		return v !== 'false' && v !== '0';
	}

	/** Verify the upgrade request; returns the identity or null. */
	verify(request: IncomingMessage | undefined): WsIdentity | null {
		const token = this.extractToken(request);
		if (!token) return null;
		const secret = this.config.get<string>('auth.jwtSecret');
		if (!secret) return null;
		const payload = this.verifyHs256(token, secret);
		if (!payload) return null;
		const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
		if (!userId) return null;
		return { userId, role: typeof payload.role === 'string' ? payload.role : 'viewer' };
	}

	private extractToken(request: IncomingMessage | undefined): string | null {
		if (!request) return null;
		const url = request.url ?? '';
		const q = url.indexOf('?');
		if (q >= 0) {
			const params = new URLSearchParams(url.slice(q + 1));
			const t = params.get('token');
			if (t) return t;
		}
		const cookie = request.headers?.cookie;
		if (typeof cookie === 'string') {
			const m = cookie.match(/(?:^|;\s*)mu_access_token=([^;]+)/);
			if (m?.[1]) return decodeURIComponent(m[1]);
		}
		return null;
	}

	private verifyHs256(
		token: string,
		secret: string,
	): { sub?: string; role?: string; exp?: number } | null {
		try {
			const parts = token.split('.');
			if (parts.length !== 3) return null;
			const [h, p, sig] = parts as [string, string, string];
			const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
			const actual = this.b64urlToBuffer(sig);
			if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
				return null;
			}
			const payload = JSON.parse(this.b64urlToBuffer(p).toString('utf8'));
			if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return null;
			return payload;
		} catch {
			return null;
		}
	}

	private b64urlToBuffer(s: string): Buffer {
		return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
	}
}

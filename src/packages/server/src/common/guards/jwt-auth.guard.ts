import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, streamSessions, users } from '../../database/schema/index.js';
import {
	ALLOWED_SHARE_ROUTE_PREFIXES,
	extractRouteIdsFromRequest,
	extractShareTokenFromRequest,
} from '../../share-links/share-token.constants.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AuthCacheService } from '../permissions/auth-cache.service.js';
import { SessionRegistryService } from '../session-registry.service.js';
import { ShareTokenVerifier } from '../share-token.verifier.js';

/** Synthetic user id attached to share-token requests */
export const SHARE_USER_SENTINEL = '__share__';

@Injectable()
export class JwtAuthGuard implements CanActivate {
	/**
	 * Cached "has the system been set up?" flag. Bootstrap-checked, then
	 * flipped to true permanently the first time we observe a user row.
	 * Once true, the localhost setup-bypass is disabled — even on
	 * localhost, a valid JWT is required.
	 */
	private setupComplete: boolean | null = null;

	constructor(
		private reflector: Reflector,
		private config: ConfigService,
		private database: DatabaseService,
		private shareVerifier: ShareTokenVerifier,
		private sessionRegistry: SessionRegistryService,
		private authCache: AuthCacheService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (isPublic) return true;

		const request = context.switchToHttp().getRequest();

		// 1. Share-token path — evaluated FIRST so localhost setup-bypass
		//    cannot silently promote a share viewer into an admin.
		const shareToken = extractShareTokenFromRequest(request);
		if (shareToken) {
			const payload = this.shareVerifier.verify(shareToken, request.server);
			if (!payload) {
				throw new UnauthorizedException('Invalid or expired share token');
			}

			const url = (request.url || '') as string;
			const urlPath = url.split('?')[0] ?? url;
			const allowed = ALLOWED_SHARE_ROUTE_PREFIXES.some((prefix) =>
				urlPath.startsWith(prefix),
			);
			if (!allowed) {
				throw new ForbiddenException('Share token not allowed for this endpoint');
			}

			const ids = extractRouteIdsFromRequest(request);
			const resolvedMovieId = this.resolveMovieIdForShareScope(ids);
			if (resolvedMovieId && resolvedMovieId !== payload.movieId) {
				throw new ForbiddenException('Share token scope mismatch');
			}

			request.user = {
				sub: SHARE_USER_SENTINEL,
				id: SHARE_USER_SENTINEL,
				role: 'share',
				shareMovieId: payload.movieId,
			};
			request.shareToken = payload;
			return true;
		}

		// 2. Normal JWT via Authorization header / cookie.
		//    We hit the AuthCache first; on miss, verify and cache.
		const rawToken = this.extractRawToken(request);
		if (rawToken) {
			const cached = this.authCache.getToken(rawToken);
			if (cached) {
				request.user = cached;
				this.assertNotDisabled(request);
				return true;
			}
		}
		try {
			await request.jwtVerify();
			if (rawToken && request.user) {
				this.authCache.setToken(rawToken, request.user);
			}
			this.assertNotDisabled(request);
			return true;
		} catch (err) {
			// A disabled account is a hard rejection — don't fall through to the
			// other token paths (they'd resolve the same disabled user).
			if (err instanceof UnauthorizedException) throw err;
			// JWT verify failed — try query token next
		}

		// 3. Query-string token (HLS.js, Safari native HLS, subtitle tracks).
		const queryToken = (request.query as Record<string, string>)?.token;
		if (queryToken) {
			try {
				const decoded = request.server.jwt.verify(queryToken);
				request.user = decoded;
				this.authCache.setToken(queryToken, decoded);
				this.assertNotDisabled(request);
				return true;
			} catch (err) {
				if (err instanceof UnauthorizedException) throw err;
				// Fall through to setup-bypass
			}
		}

		// 4. Setup bypass: when *zero* users exist, localhost is allowed in
		//    as a synthetic admin so the /auth/setup flow can run. Once a
		//    real user exists, this branch is permanently disabled.
		if (this.config.get<boolean>('auth.localBypass', true) && this.isLoopback(request)) {
			if (!this.isSetupComplete()) {
				request.user = { sub: '__setup__', role: 'admin' };
				return true;
			}
		}

		throw new UnauthorizedException('Invalid or expired token');
	}

	/**
	 * Reject requests from an admin-disabled account. The user id comes from the
	 * resolved JWT payload (`sub`); share/setup synthetic identities are exempt.
	 * Uses the 5-min auth cache, so disabling takes effect once the token cache
	 * is cleared (ProfileService.setUserDisabled invalidates both caches).
	 */
	private assertNotDisabled(request: any): void {
		const userId: string | undefined = request.user?.sub ?? request.user?.id;
		if (!userId || userId === SHARE_USER_SENTINEL || userId === '__setup__') return;
		const cached = this.authCache.getUser(userId);
		if (cached?.disabled) {
			throw new UnauthorizedException('Account disabled');
		}
	}

	private extractRawToken(request: any): string | null {
		const auth = request.headers?.authorization;
		if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
			return auth.slice(7).trim() || null;
		}
		const cookieHeader = request.headers?.cookie;
		if (typeof cookieHeader === 'string') {
			const match = cookieHeader.match(/(?:^|;\s*)mu_access_token=([^;]+)/);
			if (match?.[1]) return decodeURIComponent(match[1]);
		}
		return null;
	}

	private isLoopback(request: any): boolean {
		const ip = request.ip ?? request.socket?.remoteAddress;
		return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
	}

	private isSetupComplete(): boolean {
		if (this.setupComplete === true) return true;
		const any = this.database.db.select({ id: users.id }).from(users).limit(1).get();
		if (any) {
			this.setupComplete = true;
			return true;
		}
		this.setupComplete = false;
		return false;
	}

	/** Called by AuthService.setup() once the first user exists. */
	markSetupComplete(): void {
		this.setupComplete = true;
	}

	private resolveMovieIdForShareScope(ids: {
		movieId?: string;
		sessionId?: string;
		fileId?: string;
	}): string | undefined {
		if (ids.movieId) return ids.movieId;

		if (ids.sessionId) {
			const registered = this.sessionRegistry.get(ids.sessionId);
			if (registered) return registered.movieId;
			const session = this.database.db
				.select({ movieId: streamSessions.movieId })
				.from(streamSessions)
				.where(eq(streamSessions.id, ids.sessionId))
				.get();
			if (session?.movieId) return session.movieId;
			return '__unresolvable__';
		}

		if (ids.fileId) {
			const file = this.database.db
				.select({ movieId: movieFiles.movieId })
				.from(movieFiles)
				.where(eq(movieFiles.id, ids.fileId))
				.get();
			return file?.movieId ?? '__unresolvable__';
		}

		return undefined;
	}
}

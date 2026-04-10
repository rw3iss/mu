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
import { SessionRegistryService } from '../session-registry.service.js';
import { ShareTokenVerifier } from '../share-token.verifier.js';

/** Synthetic user id attached to share-token requests */
export const SHARE_USER_SENTINEL = '__share__';

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(
		private reflector: Reflector,
		private config: ConfigService,
		private database: DatabaseService,
		private shareVerifier: ShareTokenVerifier,
		private sessionRegistry: SessionRegistryService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (isPublic) return true;

		const request = context.switchToHttp().getRequest();

		// 1. Share-token path — evaluated FIRST so localhost localBypass cannot
		//    silently promote a share viewer into an admin.
		const shareToken = extractShareTokenFromRequest(request);
		if (shareToken) {
			const payload = this.shareVerifier.verify(shareToken, request.server);
			if (!payload) {
				throw new UnauthorizedException('Invalid or expired share token');
			}

			// Route-prefix allowlist: share tokens may only hit stream/movies/verify.
			const url = (request.url || '') as string;
			const urlPath = url.split('?')[0] ?? url;
			const allowed = ALLOWED_SHARE_ROUTE_PREFIXES.some((prefix) =>
				urlPath.startsWith(prefix),
			);
			if (!allowed) {
				throw new ForbiddenException('Share token not allowed for this endpoint');
			}

			// Scope check: resolve route params to a movieId and compare.
			const ids = extractRouteIdsFromRequest(request);
			const resolvedMovieId = this.resolveMovieIdForShareScope(ids);
			if (resolvedMovieId && resolvedMovieId !== payload.movieId) {
				throw new ForbiddenException('Share token scope mismatch');
			}
			// If no id was resolvable, allow only for endpoints that don't need one
			// (the allowlist already narrowed this to safe prefixes).

			request.user = {
				sub: SHARE_USER_SENTINEL,
				id: SHARE_USER_SENTINEL,
				role: 'share',
				shareMovieId: payload.movieId,
			};
			request.shareToken = payload;
			return true;
		}

		// 2. Normal JWT via Authorization header
		try {
			await request.jwtVerify();
			return true;
		} catch {
			// JWT header failed — try query parameter token (for HLS.js / native video streams)
		}

		// 3. Query-string token (HLS.js, Safari native HLS, subtitle tracks)
		const queryToken = (request.query as Record<string, string>)?.token;
		if (queryToken) {
			try {
				const decoded = request.server.jwt.verify(queryToken);
				request.user = decoded;
				return true;
			} catch {
				// Query token invalid — fall through to local bypass
			}
		}

		// 4. Local bypass: for localhost connections without a valid JWT,
		//    look up the first admin user from the database
		if (this.config.get<boolean>('auth.localBypass', true)) {
			const ip = request.ip ?? request.socket?.remoteAddress;
			if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
				const admin = this.database.db
					.select({ id: users.id, username: users.username, role: users.role })
					.from(users)
					.where(eq(users.role, 'admin'))
					.limit(1)
					.get();

				if (admin) {
					request.user = { sub: admin.id, role: admin.role };
					return true;
				}
			}
		}

		throw new UnauthorizedException('Invalid or expired token');
	}

	/**
	 * Given whichever route param we have (movieId, sessionId, fileId),
	 * resolve back to a movieId for share-token scope enforcement.
	 * Returns undefined if no id was present.
	 */
	private resolveMovieIdForShareScope(ids: {
		movieId?: string;
		sessionId?: string;
		fileId?: string;
	}): string | undefined {
		if (ids.movieId) return ids.movieId;

		if (ids.sessionId) {
			// Prefer in-memory registry (covers sessions skipped for share viewers too)
			const registered = this.sessionRegistry.get(ids.sessionId);
			if (registered) return registered.movieId;
			// Fall back: direct DB lookup, in case a share viewer somehow reached a
			// real user's session. Scope check will reject on mismatch.
			const session = this.database.db
				.select({ movieId: streamSessions.movieId })
				.from(streamSessions)
				.where(eq(streamSessions.id, ids.sessionId))
				.get();
			if (session?.movieId) return session.movieId;
			// Session id provided but not resolvable → fail closed
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

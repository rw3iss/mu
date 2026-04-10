import { Injectable } from '@nestjs/common';
import { SHARE_TOKEN_TYPE, type ShareTokenPayload } from '../share-links/share-token.constants.js';

/**
 * Thin wrapper around fastify-jwt that only knows how to VERIFY share tokens.
 *
 * Lives in `common/` (not `share-links/`) so the global JwtAuthGuard can depend on it
 * without creating a circular import between CommonModule and ShareLinksModule.
 * Token CREATION stays in ShareLinksService.
 */
@Injectable()
export class ShareTokenVerifier {
	/**
	 * Verify a share token against the fastify JWT instance.
	 * Returns the decoded payload on success, or null if invalid / wrong type.
	 */
	verify(token: string, fastifyInstance: any): ShareTokenPayload | null {
		try {
			const decoded = fastifyInstance.jwt.verify(token) as ShareTokenPayload;
			if (!decoded || decoded.type !== SHARE_TOKEN_TYPE || !decoded.movieId) {
				return null;
			}
			return decoded;
		} catch {
			return null;
		}
	}
}

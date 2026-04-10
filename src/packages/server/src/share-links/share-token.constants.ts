/**
 * Constants and helpers for the per-movie share link feature.
 */

export const SHARE_TOKEN_SETTING_KEY = 'share.tokenExpiryDays';
export const SHARE_TOKEN_DEFAULT_DAYS = 30;
export const SHARE_TOKEN_TYPE = 'share';

/**
 * URL path prefixes that a share token is allowed to access.
 * Anything outside this list is rejected even if the token is otherwise valid.
 */
export const ALLOWED_SHARE_ROUTE_PREFIXES = [
	'/api/v1/stream',
	'/api/v1/movies',
	'/api/v1/share-links/verify',
];

export interface ShareTokenPayload {
	movieId: string;
	type: typeof SHARE_TOKEN_TYPE;
	iat?: number;
	exp?: number;
}

/**
 * Try to extract a share token from a Fastify request.
 * Checks header `X-Share-Token` first, then query `shareToken` (for native <video> URLs).
 */
export function extractShareTokenFromRequest(request: any): string | null {
	const header = request.headers?.['x-share-token'];
	if (typeof header === 'string' && header.length > 0) return header;
	const query = request.query?.shareToken;
	if (typeof query === 'string' && query.length > 0) return query;
	return null;
}

/**
 * Pull any identifying param from the route that we can resolve to a movieId.
 */
export function extractRouteIdsFromRequest(request: any): {
	movieId?: string;
	sessionId?: string;
	fileId?: string;
} {
	const params = (request.params || {}) as Record<string, string>;
	return {
		movieId: params.movieId || params.id,
		sessionId: params.sessionId,
		fileId: params.fileId,
	};
}

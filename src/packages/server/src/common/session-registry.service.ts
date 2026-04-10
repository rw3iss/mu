import { Injectable } from '@nestjs/common';

/**
 * In-memory registry mapping streamSessionId → movieId/movieFileId.
 *
 * Used by the JwtAuthGuard's share-token path to verify that a share token
 * for movie X is only being used against sessions/files that belong to movie X,
 * without requiring a database round-trip on every HLS segment request.
 *
 * StreamService writes entries here when a session starts and clears them on end.
 */
@Injectable()
export class SessionRegistryService {
	private readonly map = new Map<string, { movieId: string; movieFileId: string }>();

	set(sessionId: string, entry: { movieId: string; movieFileId: string }): void {
		this.map.set(sessionId, entry);
	}

	get(sessionId: string): { movieId: string; movieFileId: string } | undefined {
		return this.map.get(sessionId);
	}

	delete(sessionId: string): void {
		this.map.delete(sessionId);
	}
}

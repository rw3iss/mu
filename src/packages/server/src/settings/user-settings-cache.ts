/**
 * In-memory cache of per-user merged settings maps.
 *
 * - 5min TTL per entry.
 * - Bust by `invalidate(userId)` when that user writes/deletes an
 *   override; bust by `invalidateAll()` when *app* settings change
 *   (because any user-key without an override falls back to app value).
 */
export class UserSettingsCache {
	private static readonly TTL_MS = 5 * 60_000;
	private cache = new Map<string, { map: Record<string, unknown>; expires: number }>();

	get(userId: string): Record<string, unknown> | null {
		const entry = this.cache.get(userId);
		if (!entry) return null;
		if (entry.expires < Date.now()) {
			this.cache.delete(userId);
			return null;
		}
		return entry.map;
	}

	set(userId: string, map: Record<string, unknown>): void {
		this.cache.set(userId, { map, expires: Date.now() + UserSettingsCache.TTL_MS });
	}

	invalidate(userId: string): void {
		this.cache.delete(userId);
	}

	invalidateAll(): void {
		this.cache.clear();
	}
}

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { users } from '../../database/schema/index.js';

interface CacheEntry<T> {
	value: T;
	expires: number;
}

class LruCache<K, V> {
	private map = new Map<K, CacheEntry<V>>();
	constructor(
		private readonly max: number,
		private readonly ttlMs: number,
	) {}

	get(key: K): V | undefined {
		const entry = this.map.get(key);
		if (!entry) return undefined;
		if (entry.expires < Date.now()) {
			this.map.delete(key);
			return undefined;
		}
		// Touch — move to LRU tail
		this.map.delete(key);
		this.map.set(key, entry);
		return entry.value;
	}

	set(key: K, value: V): void {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, { value, expires: Date.now() + this.ttlMs });
		while (this.map.size > this.max) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) break;
			this.map.delete(oldest);
		}
	}

	delete(key: K): void {
		this.map.delete(key);
	}

	clear(): void {
		this.map.clear();
	}
}

export interface CachedUser {
	id: string;
	username: string;
	role: string;
}

/**
 * Hot-path cache for JWT-verify results and user-row lookups.
 *
 * - tokenCache: { rawToken -> JwtPayload } 60s TTL. Verified payloads are
 *   reused as long as the underlying JWT is unexpired.
 * - userCache: { userId -> { id, username, role } } 5min TTL. Used by
 *   guards to confirm the user still exists / has the expected role
 *   without hitting SQLite per request.
 *
 * Invalidation responsibilities live with whoever mutates user state:
 *   - UsersService.update / delete -> invalidateUser(id)
 *   - AuthService.setup            -> invalidateAllUsers()
 *   - Password change              -> invalidateUser(id) + drop token cache
 */
@Injectable()
export class AuthCacheService {
	private static readonly TOKEN_TTL = 60_000; // 1 min
	private static readonly USER_TTL = 5 * 60_000; // 5 min

	private readonly tokenCache = new LruCache<string, unknown>(1000, AuthCacheService.TOKEN_TTL);
	private readonly userCache = new LruCache<string, CachedUser>(500, AuthCacheService.USER_TTL);

	constructor(private readonly database: DatabaseService) {}

	getToken(token: string): unknown | undefined {
		return this.tokenCache.get(token);
	}

	setToken(token: string, payload: unknown): void {
		this.tokenCache.set(token, payload);
	}

	dropToken(token: string): void {
		this.tokenCache.delete(token);
	}

	/** Loads + caches a user. Returns undefined if no such id. */
	getUser(userId: string): CachedUser | undefined {
		const hit = this.userCache.get(userId);
		if (hit) return hit;
		const row = this.database.db
			.select({ id: users.id, username: users.username, role: users.role })
			.from(users)
			.where(eq(users.id, userId))
			.get();
		if (!row) return undefined;
		this.userCache.set(userId, row);
		return row;
	}

	invalidateUser(userId: string): void {
		this.userCache.delete(userId);
	}

	invalidateAllUsers(): void {
		this.userCache.clear();
		this.tokenCache.clear();
	}
}

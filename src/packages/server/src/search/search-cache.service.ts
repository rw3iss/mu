import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { searchCache } from '../database/schema/search-cache.js';
import { normalizeQuery } from './dedup.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SearchCacheService {
	constructor(private readonly database: DatabaseService) {}

	private hash(type: string, q: string, source: string): string {
		return createHash('sha1').update(`${type}|${q}|${source}`).digest('hex');
	}

	get<T>(type: 'movie' | 'person', query: string, source: 'tmdb' | 'omdb' | 'trakt'): T[] | null {
		const q = normalizeQuery(query);
		const id = this.hash(type, q, source);
		const row = this.database.db.select().from(searchCache).where(eq(searchCache.id, id)).get();
		if (!row) return null;
		const age = Date.now() - new Date(row.fetchedAt).getTime();
		if (age > TTL_MS) return null;
		try {
			return JSON.parse(row.payload) as T[];
		} catch {
			return null;
		}
	}

	set<T>(
		type: 'movie' | 'person',
		query: string,
		source: 'tmdb' | 'omdb' | 'trakt',
		items: T[],
	): void {
		const q = normalizeQuery(query);
		const id = this.hash(type, q, source);
		const payload = JSON.stringify(items);
		const fetchedAt = new Date().toISOString();
		this.database.db
			.insert(searchCache)
			.values({ id, type, normalizedQuery: q, source, payload, fetchedAt })
			.onConflictDoUpdate({
				target: searchCache.id,
				set: { payload, fetchedAt },
			})
			.run();
	}
}

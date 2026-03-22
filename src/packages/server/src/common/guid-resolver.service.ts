import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles } from '../database/schema/movie-files.js';
import { movies } from '../database/schema/movies.js';
import { streamSessions } from '../database/schema/stream-sessions.js';

interface CacheEntry {
	name: string;
	expiresAt: number;
}

/** Cache TTL in milliseconds (30 minutes). */
const CACHE_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class GuidResolverService {
	private readonly logger = new Logger(GuidResolverService.name);
	private readonly cache = new Map<string, CacheEntry>();
	private readonly customResolvers = new Map<string, (guid: string) => Promise<string | null>>();

	constructor(private readonly database: DatabaseService) {}

	/**
	 * Synchronous GUID resolver. Returns a human-readable label from cache,
	 * or the raw GUID on cache miss.
	 *
	 * Format: "Movie Title (abc12345)" if cached, or just "abc12345" if not.
	 */
	resolve(guid: string): string {
		const entry = this.cache.get(guid);
		if (entry) {
			if (entry.expiresAt > Date.now()) {
				const short = guid.slice(0, 8);
				return `${entry.name} (${short})`;
			}
			// Lazy eviction
			this.cache.delete(guid);
		}
		return guid.slice(0, 8);
	}

	/**
	 * Pre-populate the cache when we already know the name from context.
	 */
	warmup(guid: string, name: string): void {
		this.cache.set(guid, {
			name,
			expiresAt: Date.now() + CACHE_TTL_MS,
		});
	}

	/**
	 * Async resolver that queries the DB on cache miss.
	 * Tries movies, movie_files, and stream_sessions tables in order.
	 */
	async resolveAsync(guid: string): Promise<string> {
		// Check cache first
		const entry = this.cache.get(guid);
		if (entry && entry.expiresAt > Date.now()) {
			const short = guid.slice(0, 8);
			return `${entry.name} (${short})`;
		}

		// 1. Try movies table
		const movie = this.database.db
			.select({ title: movies.title })
			.from(movies)
			.where(eq(movies.id, guid))
			.get();
		if (movie) {
			this.warmup(guid, movie.title);
			return `${movie.title} (${guid.slice(0, 8)})`;
		}

		// 2. Try movie_files table
		const file = this.database.db
			.select({
				movieId: movieFiles.movieId,
				fileName: movieFiles.fileName,
			})
			.from(movieFiles)
			.where(eq(movieFiles.id, guid))
			.get();
		if (file) {
			// Try to get parent movie title
			const parentMovie = this.database.db
				.select({ title: movies.title })
				.from(movies)
				.where(eq(movies.id, file.movieId))
				.get();
			const name = parentMovie?.title ?? file.fileName ?? guid;
			this.warmup(guid, name);
			return `${name} (${guid.slice(0, 8)})`;
		}

		// 3. Try stream_sessions table
		const session = this.database.db
			.select({ movieId: streamSessions.movieId })
			.from(streamSessions)
			.where(eq(streamSessions.id, guid))
			.get();
		if (session) {
			const sessionMovie = this.database.db
				.select({ title: movies.title })
				.from(movies)
				.where(eq(movies.id, session.movieId))
				.get();
			if (sessionMovie) {
				this.warmup(guid, sessionMovie.title);
				return `${sessionMovie.title} (${guid.slice(0, 8)})`;
			}
		}

		// 4. Try custom resolvers
		for (const [, resolver] of this.customResolvers) {
			try {
				const result = await resolver(guid);
				if (result) {
					this.warmup(guid, result);
					return `${result} (${guid.slice(0, 8)})`;
				}
			} catch {
				// Skip failing resolvers
			}
		}

		return guid.slice(0, 8);
	}

	/**
	 * Register a custom resolver for future extensibility.
	 * Other services can register resolvers that are tried when standard tables miss.
	 */
	registerResolver(type: string, resolver: (guid: string) => Promise<string | null>): void {
		this.customResolvers.set(type, resolver);
	}
}

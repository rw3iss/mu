import { nowISO, type SoundtrackDto } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies, soundtrackCache } from '../database/schema/index.js';
import { MusicBrainzClient } from './musicbrainz.client.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A found soundtrack is stable — cache it for a month. */
const FOUND_TTL_MS = 30 * DAY_MS;
/** A miss might be added to MusicBrainz later — re-check every few days. */
const MISS_TTL_MS = 3 * DAY_MS;

@Injectable()
export class SoundtrackService {
	private readonly logger = new Logger('SoundtrackService');
	/** In-flight lookups, de-duped per movie so concurrent requests share one fetch. */
	private inFlight = new Map<string, Promise<SoundtrackDto>>();

	constructor(
		private readonly database: DatabaseService,
		private readonly musicbrainz: MusicBrainzClient,
	) {}

	/**
	 * Resolve a movie's soundtrack (album tracklist) from cache or MusicBrainz.
	 * Always resolves — a miss returns `{ found: false, release: null }`.
	 */
	async getForMovie(movieId: string): Promise<SoundtrackDto> {
		const cached = this.readCache(movieId);
		if (cached) return cached;

		const existing = this.inFlight.get(movieId);
		if (existing) return existing;

		const task = this.fetchAndCache(movieId).finally(() => this.inFlight.delete(movieId));
		this.inFlight.set(movieId, task);
		return task;
	}

	private async fetchAndCache(movieId: string): Promise<SoundtrackDto> {
		const movie = this.database.db
			.select({ title: movies.title, year: movies.year })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();

		const fetchedAt = nowISO();
		if (!movie) {
			return { movieId, found: false, release: null, source: 'musicbrainz', fetchedAt };
		}

		let dto: SoundtrackDto;
		try {
			const release = await this.musicbrainz.findSoundtrack(movie.title, movie.year ?? null);
			dto = {
				movieId,
				found: !!release,
				release,
				source: 'musicbrainz',
				fetchedAt,
			};
		} catch (err) {
			// Defensive — the client already swallows errors, but never let a
			// soundtrack lookup break the movie page.
			this.logger.warn(`Soundtrack lookup failed for ${movieId}: ${(err as Error).message}`);
			dto = { movieId, found: false, release: null, source: 'musicbrainz', fetchedAt };
		}

		this.writeCache(dto);
		return dto;
	}

	private readCache(movieId: string): SoundtrackDto | null {
		const row = this.database.db
			.select()
			.from(soundtrackCache)
			.where(eq(soundtrackCache.movieId, movieId))
			.get();
		if (!row) return null;
		const age = Date.now() - new Date(row.fetchedAt).getTime();
		const ttl = row.found ? FOUND_TTL_MS : MISS_TTL_MS;
		if (age > ttl) return null;
		try {
			return JSON.parse(row.payload) as SoundtrackDto;
		} catch {
			return null;
		}
	}

	private writeCache(dto: SoundtrackDto): void {
		this.database.db
			.insert(soundtrackCache)
			.values({
				movieId: dto.movieId,
				found: dto.found,
				payload: JSON.stringify(dto),
				fetchedAt: dto.fetchedAt,
			})
			.onConflictDoUpdate({
				target: soundtrackCache.movieId,
				set: { found: dto.found, payload: JSON.stringify(dto), fetchedAt: dto.fetchedAt },
			})
			.run();
	}
}

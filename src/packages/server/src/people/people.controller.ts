import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { PeopleService } from './people.service.js';

@Controller('people')
export class PeopleController {
	constructor(
		private readonly people: PeopleService,
		private readonly database: DatabaseService,
	) {}

	@Get(':key')
	async get(@Param('key') key: string) {
		const person = await this.people.getOrFetch(key);
		if (!person) throw new NotFoundException('Person not found');

		// Cross-reference known-for credits against the library so the
		// client can render "in your library" affordances without an
		// extra roundtrip per credit.
		const tmdbIds = person.knownForMovies
			.filter((c) => c.mediaType === 'movie')
			.map((c) => c.tmdbId);
		if (tmdbIds.length > 0) {
			const owned = this.database.db
				.select({ id: movies.id, tmdbId: movies.tmdbId })
				.from(movies)
				.where(inArray(movies.tmdbId, tmdbIds))
				.all();
			const tmdbToId = new Map<number, string>();
			for (const r of owned) if (r.tmdbId) tmdbToId.set(r.tmdbId, r.id);
			for (const c of person.knownForMovies) {
				c.movieId = tmdbToId.get(c.tmdbId) ?? null;
			}
		}

		return { person };
	}
}

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Canonical person records (actors, directors, writers, …) used by
 * the Favorites feature and the Person Details page. A person row is
 * shared across users — favoriting only creates a row in `favorites`
 * pointing at this `id`.
 *
 * `externalId` is the namespaced lookup key the frontend operates on
 * (e.g. `tmdb:287`, `name:brad-pitt`). It's stable across instances
 * so the same id appears in cast lists, favorites, and URLs without
 * a server roundtrip.
 */
export const people = sqliteTable(
	'people',
	{
		id: text('id').primaryKey(),
		externalId: text('external_id').notNull(),
		source: text('source').notNull(),
		tmdbId: integer('tmdb_id'),
		imdbId: text('imdb_id'),
		name: text('name').notNull(),
		profileUrl: text('profile_url'),
		birthday: text('birthday'),
		placeOfBirth: text('place_of_birth'),
		deathday: text('deathday'),
		biography: text('biography'),
		knownForDepartment: text('known_for_department'),
		gender: integer('gender'),
		popularity: real('popularity'),
		alsoKnownAs: text('also_known_as'),
		metadata: text('metadata'),
		fetchedAt: text('fetched_at'),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(table) => ({
		externalIdIdx: uniqueIndex('people_external_id_idx').on(table.externalId),
		tmdbIdIdx: index('people_tmdb_id_idx').on(table.tmdbId),
		imdbIdIdx: index('people_imdb_id_idx').on(table.imdbId),
		nameIdx: index('people_name_idx').on(table.name),
	}),
);

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;

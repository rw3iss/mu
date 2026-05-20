import { real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { people } from './people.ts';

/**
 * Same shape as movie_identities, but for cast / crew members. Lets
 * a single canonical person row be referenced by TMDB person ID,
 * IMDB nm-id, Wikidata QID, and any other source we wire in.
 *
 * The existing `people.externalId` namespaced column ('tmdb:N' /
 * 'name:slug') stays as the primary external identifier. This table
 * captures every ADDITIONAL identifier the system learns about the
 * same person across sources.
 */
export const personIdentities = sqliteTable(
	'person_identities',
	{
		id: text('id').primaryKey(),
		personId: text('person_id').references(() => people.id, { onDelete: 'cascade' }),
		source: text('source').notNull(),
		externalId: text('external_id').notNull(),
		confidence: real('confidence').default(1.0).notNull(),
		addedAt: text('added_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		sourceExternal: uniqueIndex('person_identities_source_external').on(t.source, t.externalId),
	}),
);

export type PersonIdentity = typeof personIdentities.$inferSelect;
export type NewPersonIdentity = typeof personIdentities.$inferInsert;

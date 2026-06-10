import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Cached movie subset of IMDB's free `title.basics.tsv.gz` bulk dataset
 * (https://datasets.imdbws.com/title.basics.tsv.gz). Updated by the
 * scheduled `imdb-datasets-sync` job (BasicsSyncService) — only kept when
 * `titleType` ∈ (movie, tvMovie) and not adult, which trims ~11.7M source
 * rows to ~700K.
 *
 * Joined with `imdb_ratings` (same tconst key) this gives a complete,
 * offline, instantly-searchable IMDB movie catalog: title, year, runtime,
 * genres, rating + votes — used by the metadata "Search" modal and the
 * federated search as a zero-latency, zero-quota source.
 *
 * Expect ~200–250 MB on disk fully populated (with indexes).
 */
export const imdbTitles = sqliteTable(
	'imdb_titles',
	{
		tconst: text('tconst').primaryKey(),
		titleType: text('title_type').notNull(),
		primaryTitle: text('primary_title').notNull(),
		originalTitle: text('original_title'),
		year: integer('year'),
		runtimeMinutes: integer('runtime_minutes'),
		/** Comma-separated genre list as shipped by IMDB (e.g. "Action,Drama"). */
		genres: text('genres'),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		// Case-insensitive title index drives the LIKE 'prefix%' fast path in
		// local search; substring fallback scans but stays acceptable at ~700K.
		titleIdx: index('imdb_titles_title_idx').on(t.primaryTitle),
		yearIdx: index('imdb_titles_year_idx').on(t.year),
	}),
);

export type ImdbTitle = typeof imdbTitles.$inferSelect;
export type NewImdbTitle = typeof imdbTitles.$inferInsert;

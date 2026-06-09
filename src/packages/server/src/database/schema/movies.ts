import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const movies = sqliteTable(
	'movies',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		originalTitle: text('original_title'),
		year: integer('year'),
		overview: text('overview'),
		tagline: text('tagline'),
		runtimeMinutes: integer('runtime_minutes'),
		releaseDate: text('release_date'),
		language: text('language'),
		country: text('country'),
		posterUrl: text('poster_url'),
		backdropUrl: text('backdrop_url'),
		trailerUrl: text('trailer_url'),
		thumbnailUrl: text('thumbnail_url'),
		thumbnailAspectRatio: real('thumbnail_aspect_ratio'),
		imdbId: text('imdb_id'),
		tmdbId: integer('tmdb_id'),
		contentRating: text('content_rating'),
		hidden: integer('hidden', { mode: 'boolean' }).default(false),
		playSettings: text('play_settings'),
		/**
		 * Subgroup FK (nullable). When set, the movie is a member of the
		 * referenced subgroup; the parent group is reached via
		 * movie_groups.parent_group_id.
		 */
		groupId: text('group_id'),
		/** Episode/part ordinal within the subgroup (e.g. 12 for E12). */
		groupEpisodeOrdinal: integer('group_episode_ordinal'),
		/**
		 * 'library' = movie has files / can be played. 'bookmark' = user
		 * saved an external recommendation they don't own. Bookmarks
		 * share the schema (so all the metadata, ratings, cast, etc.
		 * work the same) but are filtered out of normal library queries.
		 */
		source: text('source').notNull().default('library'),
		/**
		 * User id of the member who uploaded this movie via the direct
		 * library-upload feature. Null for auto-scanned files (no uploader).
		 * Auxiliary attribution only — not enforced or surfaced widely yet.
		 */
		uploadedBy: text('uploaded_by'),
		addedAt: text('added_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(table) => ({
		imdbIdIdx: index('movies_imdb_id_idx').on(table.imdbId),
		tmdbIdIdx: index('movies_tmdb_id_idx').on(table.tmdbId),
		groupIdIdx: index('movies_group_id_idx').on(table.groupId),
		sourceIdx: index('movies_source_idx').on(table.source),
	}),
);

export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;

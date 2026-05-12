import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Movie groups — the parent/subgroup hierarchy that wraps related
 * `movies` rows together (TV seasons, multi-part collections, etc.).
 *
 * The table is self-referential via `parentGroupId`:
 *   - A row with `type='parent'` and `parentGroupId=NULL` is the top of
 *     the hierarchy ("Seinfeld" the show).
 *   - A row with `type='subgroup'` and `parentGroupId=<parent.id>` is a
 *     child group inside a parent ("Seinfeld - Season 3").
 *
 * Episodes / movies attach to subgroups, not directly to parents, via
 * the new `movies.group_id` column.
 *
 * `group_type` is a soft hint for naming + iconography ('series',
 * 'show', 'collection', 'trilogy', …). Defaults to 'series'; the
 * detector may override and the user can edit it in the UI.
 */
export const movieGroups = sqliteTable(
	'movie_groups',
	{
		id: text('id').primaryKey(),
		type: text('type', { enum: ['parent', 'subgroup'] }).notNull(),
		groupType: text('group_type').notNull().default('series'),
		name: text('name').notNull(),

		// Self-FK — null for top-level parents.
		parentGroupId: text('parent_group_id'),

		// Ordering within the parent (season number for TV; part # for multi-part).
		ordinal: integer('ordinal'),

		// External-metadata IDs — populated by phase-2 TVDB/TMDB-TV provider.
		tmdbTvId: integer('tmdb_tv_id'),
		imdbId: text('imdb_id'),

		// Cosmetic. Optional; client falls back to assembling a tile grid
		// from the first N children when posterUrl is null.
		posterUrl: text('poster_url'),
		backdropUrl: text('backdrop_url'),
		overview: text('overview'),

		// Pipeline state.
		status: text('status', { enum: ['auto', 'unsure', 'confirmed', 'rejected'] })
			.notNull()
			.default('auto'),
		confidence: real('confidence'),

		/**
		 * JSON array of alternative parent candidates the detector
		 * considered, e.g. `[{"parentGroupId":"abc","confidence":0.65}]`.
		 * Surfaced in the "Move to…" UI for unsure subgroups.
		 */
		altParents: text('alt_parents'),

		// Provenance.
		detectionSource: text('detection_source'),

		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		parentIdx: index('movie_groups_parent_idx').on(t.parentGroupId),
		typeIdx: index('movie_groups_type_idx').on(t.type),
		statusIdx: index('movie_groups_status_idx').on(t.status),
	}),
);

export type MovieGroup = typeof movieGroups.$inferSelect;
export type NewMovieGroup = typeof movieGroups.$inferInsert;

export type MovieGroupStatus = MovieGroup['status'];
export type MovieGroupTypeRole = MovieGroup['type'];

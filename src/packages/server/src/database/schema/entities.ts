import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { playlists } from './playlists.ts';
import { users } from './users.ts';

/**
 * Polymorphic user-data tables. Each row points at any catalogue entity via
 * (entity_type, entity_id) — 'movie' | 'person' | 'artist' | 'album' | 'track'.
 *
 * No FK to the entity tables (SQLite can't express a polymorphic FK and
 * foreign_keys is ON), so deletes are cleaned up in code by
 * EntityLifecycleService.purge(ref) instead of ON DELETE CASCADE.
 * Backfilled from the movie-only tables by scripts/migrations/media-kinds.js.
 */

export const entityRatings = sqliteTable(
	'entity_ratings',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		rating: real('rating').notNull(),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		uniq: uniqueIndex('entity_ratings_uniq').on(t.userId, t.entityType, t.entityId),
		entityIdx: index('entity_ratings_entity_idx').on(t.entityType, t.entityId),
	}),
);

export const entityComments = sqliteTable(
	'entity_comments',
	{
		id: text('id').primaryKey(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		parentId: text('parent_id'),
		/** Playback timestamp; only meaningful for movies and tracks. */
		timeSeconds: real('time_seconds'),
		text: text('text').notNull(),
		edited: integer('edited', { mode: 'boolean' }).default(false),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		entityIdx: index('entity_comments_entity_idx').on(t.entityType, t.entityId),
		parentIdx: index('entity_comments_parent_idx').on(t.parentId),
	}),
);

export const entityCommentReactions = sqliteTable(
	'entity_comment_reactions',
	{
		id: text('id').primaryKey(),
		commentId: text('comment_id')
			.notNull()
			.references(() => entityComments.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		createdAt: text('created_at').notNull(),
	},
	(t) => ({
		uniq: uniqueIndex('entity_comment_reactions_uniq').on(t.commentId, t.userId, t.emoji),
		commentIdx: index('entity_comment_reactions_comment_idx').on(t.commentId),
	}),
);

export const playHistory = sqliteTable(
	'play_history',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		positionSeconds: integer('position_seconds').default(0),
		durationWatchedSeconds: integer('duration_watched_seconds').default(0),
		completed: integer('completed', { mode: 'boolean' }).default(false),
		playCount: integer('play_count').default(0),
		lastPlayedAt: text('last_played_at').notNull(),
	},
	(t) => ({
		userEntityIdx: index('play_history_user_entity_idx').on(t.userId, t.entityType, t.entityId),
		userRecentIdx: index('play_history_user_recent_idx').on(t.userId, t.lastPlayedAt),
		entityIdx: index('play_history_entity_idx').on(t.entityType, t.entityId),
	}),
);

export const entityWatchlist = sqliteTable(
	'entity_watchlist',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		addedAt: text('added_at').notNull(),
		notes: text('notes'),
	},
	(t) => ({
		uniq: uniqueIndex('entity_watchlist_uniq').on(t.userId, t.entityType, t.entityId),
	}),
);

export const playlistItems = sqliteTable(
	'playlist_items',
	{
		id: text('id').primaryKey(),
		playlistId: text('playlist_id')
			.notNull()
			.references(() => playlists.id, { onDelete: 'cascade' }),
		itemType: text('item_type').notNull(),
		itemId: text('item_id').notNull(),
		position: integer('position').notNull().default(0),
		addedAt: text('added_at').notNull(),
		/** User who added the row — lets public-edit contributors remove their own adds. */
		addedBy: text('added_by'),
		remoteTitle: text('remote_title'),
		remotePosterUrl: text('remote_poster_url'),
		remoteServerId: text('remote_server_id'),
	},
	(t) => ({
		uniq: uniqueIndex('playlist_items_uniq').on(t.playlistId, t.itemType, t.itemId),
		playlistIdx: index('playlist_items_playlist_idx').on(t.playlistId, t.position),
		itemIdx: index('playlist_items_item_idx').on(t.itemType, t.itemId),
	}),
);

export type EntityRating = typeof entityRatings.$inferSelect;
export type EntityComment = typeof entityComments.$inferSelect;
export type PlayHistoryRow = typeof playHistory.$inferSelect;
export type EntityWatchlistRow = typeof entityWatchlist.$inferSelect;
export type PlaylistItem = typeof playlistItems.$inferSelect;

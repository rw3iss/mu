import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users.ts';

/**
 * Polymorphic favorites table. `entityType` discriminates between
 * 'person' (entityId → people.id) and 'movie' (entityId → movies.id).
 * No FK to entity tables because SQLite can't FK polymorphically;
 * orphan cleanup is handled in the service layer / a scheduled job.
 *
 * `role` is purely advisory metadata: 'actor', 'director', 'writer',
 * or null. It captures the cast role under which the user favorited
 * a person, so the Favorites page can filter by Type without an
 * extra join through movie credits.
 */
export const favorites = sqliteTable(
	'favorites',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		role: text('role'),
		createdAt: text('created_at').notNull(),
	},
	(table) => ({
		uniqueIdx: uniqueIndex('favorites_unique_idx').on(
			table.userId,
			table.entityType,
			table.entityId,
		),
		userIdx: index('favorites_user_idx').on(table.userId),
		userTypeIdx: index('favorites_user_type_idx').on(table.userId, table.entityType),
	}),
);

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;

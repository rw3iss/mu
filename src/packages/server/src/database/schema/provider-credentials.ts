import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Per-provider credential storage. The `config` column holds a JSON
 * object whose shape is declared by the provider (`configFields` on
 * the Provider interface) — e.g. `{ clientId, clientSecret }` for
 * Trakt, `{ apiKey }` for OpenAI, `{}` for providers with no auth.
 *
 * Cleartext-at-rest for v1 (server is private, behind admin auth).
 * The `encrypted` flag is reserved for a future AES-GCM upgrade keyed
 * off `MU_SECRETS_KEY`; no application code outside
 * ProviderCredentialsService needs to change when that lands.
 */
export const providerCredentials = sqliteTable('provider_credentials', {
	providerId: text('provider_id').primaryKey(),
	config: text('config').notNull(),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
	addedAt: text('added_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type NewProviderCredential = typeof providerCredentials.$inferInsert;

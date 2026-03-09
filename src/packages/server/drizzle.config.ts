import { defineConfig } from 'drizzle-kit';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.env.MU_DATABASE_SQLITE_PATH || '../../data/db/mu.db';
const dbDir = dirname(dbPath);

if (!existsSync(dbDir)) {
	mkdirSync(dbDir, { recursive: true });
}

export default defineConfig({
	schema: './src/database/schema/*.ts',
	out: './src/database/migrations',
	dialect: 'sqlite',
	dbCredentials: {
		url: dbPath,
	},
});

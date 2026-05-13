import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// Anchor all relative paths to the project root so the DB file
// drizzle-kit targets is the same one the server runs against,
// regardless of cwd. This file lives at
// `<root>/src/packages/server/drizzle.config.ts` → 3 levels up.
const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(CONFIG_DIR, '..', '..', '..');

const envPath = process.env.MU_DATABASE_SQLITE_PATH;
const dbPath = envPath
	? isAbsolute(envPath)
		? envPath
		: resolve(PROJECT_ROOT, envPath)
	: resolve(PROJECT_ROOT, 'data', 'db', 'mu.db');

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

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { configSchema } from './config.schema.js';
import type { MuConfig } from './config.types.js';

/**
 * Generate a random 64-character hex string for use as a secret.
 */
function generateSecret(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Deep-merge source into target. Arrays in source replace those in target.
 */
function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...target };

	for (const key of Object.keys(source)) {
		const srcVal = source[key];
		const tgtVal = result[key];

		if (
			srcVal !== null &&
			srcVal !== undefined &&
			typeof srcVal === 'object' &&
			!Array.isArray(srcVal) &&
			tgtVal !== null &&
			tgtVal !== undefined &&
			typeof tgtVal === 'object' &&
			!Array.isArray(tgtVal)
		) {
			result[key] = deepMerge(
				tgtVal as Record<string, unknown>,
				srcVal as Record<string, unknown>,
			);
		} else {
			result[key] = srcVal;
		}
	}

	return result;
}

/**
 * Parse environment variables with the MU_ prefix into a nested config object.
 *
 * Supports two separator styles:
 *   - Double underscore: MU_SERVER__PORT=4000  -> { server: { port: "4000" } }
 *   - Single underscore:  MU_SERVER_PORT=4000  -> { server: { port: "4000" } }
 *
 * Double-underscore separators are checked first. If the key contains `__`,
 * it is split on `__`. Otherwise it is split on `_`. Keys are lowercased.
 *
 * Values that look like numbers or booleans are coerced accordingly.
 */
function envToConfig(env: NodeJS.ProcessEnv): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [envKey, envValue] of Object.entries(env)) {
		if (!envKey.startsWith('MU_') || envValue === undefined) continue;

		const stripped = envKey.slice(3); // remove MU_
		const parts = stripped.includes('__')
			? stripped.split('__').map((p) => p.toLowerCase())
			: stripped.split('_').map((p) => p.toLowerCase());

		if (parts.length === 0) continue;

		let coerced: unknown = envValue;

		// Coerce booleans
		if (envValue.toLowerCase() === 'true') coerced = true;
		else if (envValue.toLowerCase() === 'false') coerced = false;
		// Coerce integers (but not hex strings that happen to be numeric)
		else if (/^\d+$/.test(envValue)) coerced = Number(envValue);

		// Walk into the result object and set the leaf value
		let cursor: Record<string, unknown> = result;
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i]!;
			if (!(part in cursor) || typeof cursor[part] !== 'object' || cursor[part] === null) {
				cursor[part] = {};
			}
			cursor = cursor[part] as Record<string, unknown>;
		}
		cursor[parts[parts.length - 1]!] = coerced;
	}

	return result;
}

/**
 * Build a minimal YAML config with auto-generated secrets.
 */
function buildDefaultYaml(): string {
	const defaults = {
		server: {
			host: '0.0.0.0',
			port: 4000,
		},
		auth: {
			jwtSecret: generateSecret(),
			cookieSecret: generateSecret(),
		},
		dataDir: '../../data',
	};

	return (
		'# Mu movie server configuration\n' +
		'# Edit this file or override values with MU_ prefixed environment variables.\n' +
		'# Example: MU_SERVER__PORT=8080 or MU_SERVER_PORT=8080\n\n' +
		yaml.dump(defaults, { lineWidth: 120, noRefs: true })
	);
}

/**
 * Load, merge, validate, and return the application configuration.
 *
 * 1. Resolve the data directory (from MU_DATA_DIR env var or default `./data`).
 * 2. Look for `config.yml` inside `<dataDir>/config/`.
 * 3. If it does not exist, generate one with random secrets.
 * 4. Parse the YAML.
 * 5. Deep-merge with environment variable overrides (MU_ prefix).
 * 6. Validate the merged object against the Zod schema.
 * 7. Create required data sub-directories.
 * 8. Return the validated MuConfig.
 */
export function loadConfig(): MuConfig {
	// Determine the data directory early so we know where to look for config.yml.
	const dataDir = resolve(process.env.MU_DATA_DIR ?? process.env.MU_DATADIR ?? './data');
	const configDir = resolve(dataDir, 'config');
	const configPath = resolve(configDir, 'config.yml');

	// Ensure the config directory exists before we try to write into it.
	ensureDir(configDir);

	// Generate a default config file if none exists.
	if (!existsSync(configPath)) {
		writeFileSync(configPath, buildDefaultYaml(), 'utf-8');
	}

	// Load and parse YAML.
	const raw = readFileSync(configPath, 'utf-8');
	const fileConfig = (yaml.load(raw) ?? {}) as Record<string, unknown>;

	// Merge environment variable overrides.
	const envConfig = envToConfig(process.env);
	const merged = deepMerge(fileConfig, envConfig);

	// Inject dataDir from the env var we already resolved (env parser splits
	// MU_DATA_DIR into { data: { dir: ... } } which doesn't match the schema's
	// top-level dataDir field)
	if (process.env.MU_DATA_DIR || process.env.MU_DATADIR) {
		merged.dataDir = dataDir;
	}

	// Inject cache.streamDir from MU_CACHE__STREAMDIR (env parser lowercases
	// to cache.streamdir, but config lookups use cache.streamDir)
	const envCacheDir = process.env.MU_CACHE__STREAMDIR || process.env.MU_CACHE_STREAMDIR;
	if (envCacheDir) {
		if (!merged.cache || typeof merged.cache !== 'object') merged.cache = {};
		(merged.cache as Record<string, unknown>).streamDir = envCacheDir;
	}

	// Inject auth.apiToken from MU_AUTH_API_TOKEN (env parser would
	// lowercase to auth.api.token which doesn't match the camelCase
	// schema key). Used by the unattended log-tail endpoint.
	const envAuthApiToken = process.env.MU_AUTH_API_TOKEN ?? process.env.MU_AUTH__APITOKEN;
	if (envAuthApiToken) {
		if (!merged.auth || typeof merged.auth !== 'object') merged.auth = {};
		(merged.auth as Record<string, unknown>).apiToken = envAuthApiToken;
	}

	// logs.dir env override — for platforms (NSSM, systemd) that redirect
	// stdout/stderr to a path not under <dataDir>/logs.
	const envLogsDir = process.env.MU_LOGS_DIR ?? process.env.MU_LOGS__DIR;
	if (envLogsDir) {
		if (!merged.logs || typeof merged.logs !== 'object') merged.logs = {};
		(merged.logs as Record<string, unknown>).dir = envLogsDir;
	}

	// Email env overrides — the generic parser lowercases camelCase keys, so map
	// the email fields explicitly. Lets the operator keep email config (incl. the
	// secret API key) in `.env` instead of config.yml.
	const E = process.env;
	const emailEnv: Record<string, unknown> = {};
	if (E.MU_EMAIL_ENABLED != null) emailEnv.enabled = E.MU_EMAIL_ENABLED === 'true';
	if (E.MU_EMAIL_PROVIDER) emailEnv.provider = E.MU_EMAIL_PROVIDER;
	if (E.MU_EMAIL_FROM_ADDRESS) emailEnv.fromAddress = E.MU_EMAIL_FROM_ADDRESS;
	if (E.MU_EMAIL_FROM_NAME) emailEnv.fromName = E.MU_EMAIL_FROM_NAME;
	if (E.MU_EMAIL_REPLY_TO) emailEnv.replyTo = E.MU_EMAIL_REPLY_TO;
	if (E.MU_EMAIL_ADMIN_EMAIL) emailEnv.adminEmail = E.MU_EMAIL_ADMIN_EMAIL;
	if (E.MU_EMAIL_RESEND_API_KEY) emailEnv.resendApiKey = E.MU_EMAIL_RESEND_API_KEY;
	if (E.MU_EMAIL_BREVO_API_KEY) emailEnv.brevoApiKey = E.MU_EMAIL_BREVO_API_KEY;
	if (E.MU_EMAIL_SITE_URL) emailEnv.siteUrl = E.MU_EMAIL_SITE_URL;
	if (Object.keys(emailEnv).length > 0) {
		merged.email = { ...((merged.email as Record<string, unknown>) ?? {}), ...emailEnv };
	}

	// Validate against the schema.
	const parsed = configSchema.parse(merged);

	const resolvedDataDir = resolve(parsed.dataDir);

	// When MU_DATA_DIR is set, override default relative paths in database/media
	// so everything lives under the custom data directory.
	if (process.env.MU_DATA_DIR || process.env.MU_DATADIR) {
		// Only override if still at Zod defaults (relative paths)
		if (parsed.database.path === './data/db/mu.db') {
			parsed.database.path = join(resolvedDataDir, 'db', 'mu.db');
		}
		if (parsed.media.thumbnailDir === './data/thumbnails') {
			parsed.media.thumbnailDir = join(resolvedDataDir, 'thumbnails');
		}
	}

	// Resolve the cache root. Precedence: explicit `cache.dir` (env MU_CACHE_DIR)
	// → `<dataDir>/cache`. Every cache subdir anchors under it unless the operator
	// set an explicit non-default override for that subdir. This lets a single
	// `MU_CACHE_DIR=/mnt/nvme/mu-cache` move streams/images/sprites/subtitles/hot
	// off a slow media HDD in one shot.
	const cacheRoot = parsed.cache.dir ? resolve(parsed.cache.dir) : join(resolvedDataDir, 'cache');
	parsed.cache.dir = cacheRoot;
	if (parsed.cache.streamDir === './data/cache/streams') {
		parsed.cache.streamDir = join(cacheRoot, 'streams');
	}
	if (parsed.cache.imageDir === './data/cache/images') {
		parsed.cache.imageDir = join(cacheRoot, 'images');
	}
	if (!parsed.cache.subtitleDir) {
		parsed.cache.subtitleDir = join(cacheRoot, 'subtitles');
	}
	if (!parsed.cache.hot.dir) {
		parsed.cache.hot.dir = join(cacheRoot, 'hot');
	}

	// Public uploads root (avatars, future chat/comment media). Empty →
	// `<dataDir>/uploads`. Served verbatim at `/uploads/*`.
	const uploadsRoot = parsed.uploads.dir
		? resolve(parsed.uploads.dir)
		: join(resolvedDataDir, 'uploads');
	parsed.uploads.dir = uploadsRoot;

	// Ensure all required data directories exist.
	const dirs = [
		resolvedDataDir,
		resolve(resolvedDataDir, 'db'),
		resolve(resolvedDataDir, 'config'),
		resolve(resolvedDataDir, 'thumbnails'),
		uploadsRoot,
		resolve(uploadsRoot, 'avatars'),
		cacheRoot,
		parsed.cache.streamDir,
		parsed.cache.imageDir,
		parsed.cache.subtitleDir,
	];
	if (parsed.cache.hot.enabled) {
		dirs.push(parsed.cache.hot.dir);
	}

	for (const dir of dirs) {
		ensureDir(dir);
	}

	return parsed;
}

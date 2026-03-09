import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
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
		dataDir: './data',
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

	// Validate against the schema.
	const parsed = configSchema.parse(merged);

	// Ensure all required data directories exist.
	const resolvedDataDir = resolve(parsed.dataDir);
	const dirs = [
		resolvedDataDir,
		resolve(resolvedDataDir, 'db'),
		resolve(resolvedDataDir, 'cache'),
		resolve(resolvedDataDir, 'cache', 'images'),
		resolve(resolvedDataDir, 'cache', 'streams'),
		resolve(resolvedDataDir, 'config'),
		resolve(resolvedDataDir, 'thumbnails'),
	];

	for (const dir of dirs) {
		ensureDir(dir);
	}

	return parsed;
}

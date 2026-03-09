import { Injectable } from '@nestjs/common';
import { loadConfig } from './config.loader.js';
import type { MuConfig } from './config.types.js';

/**
 * Traverse an object using a dot-notation path and return the value found,
 * or `defaultValue` if any segment along the path is undefined.
 */
function getByPath(obj: unknown, path: string, defaultValue?: unknown): unknown {
	const segments = path.split('.');
	let current: unknown = obj;

	for (const segment of segments) {
		if (current === null || current === undefined || typeof current !== 'object') {
			return defaultValue;
		}
		current = (current as Record<string, unknown>)[segment];
	}

	return current === undefined ? defaultValue : current;
}

@Injectable()
export class ConfigService {
	private readonly config: MuConfig;

	constructor() {
		this.config = loadConfig();
	}

	/**
	 * Retrieve a configuration value by dot-notation path.
	 *
	 * @example
	 *   configService.get('server.port')         // 4000
	 *   configService.get('media.libraryPaths')   // string[]
	 *   configService.get('missing.key', 42)      // 42
	 */
	get<T = unknown>(path: string, defaultValue?: T): T {
		return getByPath(this.config, path, defaultValue) as T;
	}

	/**
	 * Return the full validated configuration object.
	 */
	getAll(): MuConfig {
		return this.config;
	}
}

import { Injectable, Logger } from '@nestjs/common';
import type { HttpMethod, PluginEndpointConfig } from './plugin.interface.js';

@Injectable()
export class PluginApiRegistryService {
	private readonly logger = new Logger('PluginApiRegistry');
	private readonly endpoints = new Map<string, PluginEndpointConfig[]>();

	register(pluginName: string, config: PluginEndpointConfig): void {
		const list = this.endpoints.get(pluginName) ?? [];
		list.push(config);
		this.endpoints.set(pluginName, list);
		this.logger.log(
			`Registered endpoint [${config.method} ${config.path}] as "${config.methodName}" for plugin "${pluginName}" (total: ${list.length})`,
		);
	}

	unregisterAll(pluginName: string): void {
		const count = this.endpoints.get(pluginName)?.length ?? 0;
		this.endpoints.delete(pluginName);
		this.logger.log(`Unregistered ${count} endpoint(s) for plugin "${pluginName}"`);
	}

	getEndpoints(pluginName: string): PluginEndpointConfig[] {
		return this.endpoints.get(pluginName) ?? [];
	}

	/**
	 * Returns the schema for all registered endpoints of a plugin.
	 * Used by the client codegen script and schema API endpoint.
	 */
	getSchema(pluginName: string): object {
		const pluginEndpoints = this.getEndpoints(pluginName);
		this.logger.debug(
			`getSchema("${pluginName}"): found ${pluginEndpoints.length} endpoint(s), registered plugins: [${[...this.endpoints.keys()].join(', ')}]`,
		);
		return {
			pluginName,
			basePath: `/plugins/${pluginName}/api`,
			endpoints: pluginEndpoints.map((ep) => ({
				methodName: ep.methodName,
				method: ep.method,
				path: ep.path,
				schema: ep.schema ?? {},
			})),
		};
	}

	/**
	 * Get schemas for all registered plugins.
	 */
	getAllSchemas(): object[] {
		const schemas: object[] = [];
		for (const pluginName of this.endpoints.keys()) {
			schemas.push(this.getSchema(pluginName));
		}
		return schemas;
	}

	async dispatch(
		pluginName: string,
		method: HttpMethod,
		path: string,
		query: Record<string, string>,
		body: unknown,
		params: Record<string, string>,
	): Promise<unknown> {
		const pluginEndpoints = this.getEndpoints(pluginName);

		for (const endpoint of pluginEndpoints) {
			if (endpoint.method !== method) continue;

			const matchedParams = this.matchPath(endpoint.path, path);
			if (matchedParams !== null) {
				return endpoint.handler({
					query,
					body,
					params: { ...params, ...matchedParams },
				});
			}
		}

		throw new Error(
			`No matching endpoint found for ${method} ${path} in plugin "${pluginName}"`,
		);
	}

	/**
	 * Match an incoming path against a registered path pattern with :param segments.
	 * Returns extracted params or null if no match.
	 */
	private matchPath(pattern: string, incoming: string): Record<string, string> | null {
		const patternParts = pattern.split('/').filter(Boolean);
		const incomingParts = incoming.split('/').filter(Boolean);

		if (patternParts.length !== incomingParts.length) {
			return null;
		}

		const extracted: Record<string, string> = {};

		for (let i = 0; i < patternParts.length; i++) {
			const patternPart = patternParts[i]!;
			const incomingPart = incomingParts[i]!;
			if (patternPart.startsWith(':')) {
				extracted[patternPart.slice(1)] = incomingPart;
			} else if (patternPart !== incomingPart) {
				return null;
			}
		}

		return extracted;
	}
}

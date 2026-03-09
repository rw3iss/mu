import { Injectable, Logger } from '@nestjs/common';
import type { PluginEndpointConfig, HttpMethod } from './plugin.interface.js';

@Injectable()
export class PluginApiRegistryService {
  private readonly logger = new Logger('PluginApiRegistry');
  private readonly endpoints = new Map<string, PluginEndpointConfig[]>();

  register(pluginName: string, config: PluginEndpointConfig): void {
    const list = this.endpoints.get(pluginName) ?? [];
    list.push(config);
    this.endpoints.set(pluginName, list);
    this.logger.log(
      `Registered endpoint ${config.method} ${config.path} for plugin "${pluginName}"`,
    );
  }

  unregisterAll(pluginName: string): void {
    this.endpoints.delete(pluginName);
    this.logger.log(`Unregistered all endpoints for plugin "${pluginName}"`);
  }

  getEndpoints(pluginName: string): PluginEndpointConfig[] {
    return this.endpoints.get(pluginName) ?? [];
  }

  getSchema(pluginName: string): object {
    const pluginEndpoints = this.getEndpoints(pluginName);
    return {
      pluginName,
      basePath: `/plugins/${pluginName}/api`,
      endpoints: pluginEndpoints.map((ep) => ({
        methodName: ep.methodName,
        method: ep.method,
        path: ep.path,
        schema: ep.schema,
      })),
    };
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
  private matchPath(
    pattern: string,
    incoming: string,
  ): Record<string, string> | null {
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

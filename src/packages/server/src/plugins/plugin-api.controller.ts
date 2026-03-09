import { Controller, Get, All, Param, Req, NotFoundException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PluginApiRegistryService } from './plugin-api-registry.service.js';
import type { HttpMethod } from './plugin.interface.js';

@Controller('plugins')
export class PluginApiController {
	constructor(private readonly apiRegistry: PluginApiRegistryService) {}

	/** Schema endpoint for a single plugin — used by client codegen */
	@Get(':name/schema')
	getSchema(@Param('name') name: string) {
		return this.apiRegistry.getSchema(name);
	}

	/** Schema endpoint for all registered plugins */
	@Get('schemas/all')
	getAllSchemas() {
		return this.apiRegistry.getAllSchemas();
	}

	/** Catch-all for plugin API requests */
	@All(':name/api/*')
	async handlePluginApi(@Param('name') name: string, @Req() req: FastifyRequest) {
		const method = req.method as HttpMethod;
		const query = (req.query ?? {}) as Record<string, string>;
		const body = req.body;

		// Extract the sub-path after /plugins/:name/api/
		const url = req.url;
		const apiPrefix = `/plugins/${name}/api/`;
		const prefixIndex = url.indexOf(apiPrefix);
		let subPath = '/';
		if (prefixIndex !== -1) {
			subPath = `/${url.slice(prefixIndex + apiPrefix.length).split('?')[0]}`;
		}

		try {
			return await this.apiRegistry.dispatch(name, method, subPath, query, body, {});
		} catch (err) {
			throw new NotFoundException(err instanceof Error ? err.message : 'No endpoint found');
		}
	}
}

import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Logger,
	NotFoundException,
	Param,
	Patch,
	Post,
	Put,
	Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ProviderEventsService } from './provider-events.service.js';
import { ProviderRegistry } from './provider-registry.service.js';
import { ProviderCredentialsService } from './provider-credentials.service.js';
import { RateLimitService } from './rate-limit.service.js';
import type { Capability, Provider } from './provider.interface.js';

interface ProviderSummary {
	id: string;
	displayName: string;
	description?: string;
	capabilities: Capability[];
	auth: 'apiKey' | 'oauth' | 'none';
	configFields: Provider['configFields'];
	rateLimit: Provider['rateLimit'];
	isConfigured: boolean;
}

/**
 * Admin-only REST surface for the provider platform. Powers the
 * Settings → Connections page on the client.
 *
 *   GET    /providers                       list summaries
 *   GET    /providers/:id                   full detail + usage + recent events
 *   PUT    /providers/:id/credentials       upsert config
 *   DELETE /providers/:id/credentials       remove
 *   PATCH  /providers/:id                   { enabled: boolean }
 *   POST   /providers/:id/test              run healthCheck()
 *   GET    /providers/:id/usage             daily history
 */
@Controller('providers')
export class ProvidersController {
	private readonly logger = new Logger('ProvidersController');

	constructor(
		private readonly registry: ProviderRegistry,
		private readonly credentials: ProviderCredentialsService,
		private readonly rateLimit: RateLimitService,
		private readonly events: ProviderEventsService,
	) {}

	@Get()
	@Roles('admin')
	list(): { providers: ProviderSummary[] } {
		return {
			providers: this.registry.list().map((p) => this.summarise(p)),
		};
	}

	@Get(':id')
	@Roles('admin')
	get(@Param('id') id: string) {
		const p = this.registry.get(id);
		if (!p) throw new NotFoundException(`Provider "${id}" not registered`);
		return {
			...this.summarise(p),
			config: this.credentials.getMasked(id, p.configFields),
			usage: this.rateLimit.snapshot(id),
			dailyUsage: this.rateLimit.dailyHistory(id, 7),
			recentEvents: this.events.recent(id, 20),
		};
	}

	@Put(':id/credentials')
	@Roles('admin')
	async setCredentials(@Param('id') id: string, @Body() body: { config: Record<string, unknown> }) {
		const p = this.registry.get(id);
		if (!p) throw new NotFoundException(`Provider "${id}" not registered`);
		if (!body || typeof body.config !== 'object' || body.config === null) {
			throw new BadRequestException('Body must be { config: { ... } }');
		}
		this.credentials.upsert(id, body.config, p.configFields);
		this.logger.log(`Credentials updated for ${id}`);
		return { ok: true, isConfigured: p.isConfigured() };
	}

	@Delete(':id/credentials')
	@Roles('admin')
	deleteCredentials(@Param('id') id: string) {
		const removed = this.credentials.delete(id);
		return { ok: removed };
	}

	@Patch(':id')
	@Roles('admin')
	patch(@Param('id') id: string, @Body() body: { enabled?: boolean }) {
		if (typeof body?.enabled !== 'boolean') {
			throw new BadRequestException('Body must include { enabled: boolean }');
		}
		const updated = this.credentials.setEnabled(id, body.enabled);
		return { ok: updated, enabled: body.enabled };
	}

	@Post(':id/test')
	@Roles('admin')
	async test(@Param('id') id: string) {
		const p = this.registry.get(id);
		if (!p) throw new NotFoundException(`Provider "${id}" not registered`);
		const started = Date.now();
		try {
			const result = await p.healthCheck();
			const durationMs = Date.now() - started;
			this.events.record({
				providerId: id,
				type: 'health_check',
				statusCode: result.ok ? 200 : 500,
				durationMs,
				payload: { detail: result.detail },
			});
			return result;
		} catch (err: any) {
			const durationMs = Date.now() - started;
			this.events.record({
				providerId: id,
				type: 'error',
				durationMs,
				payload: { message: err?.message ?? 'unknown' },
			});
			return { ok: false, detail: err?.message ?? 'unknown', checkedAt: new Date().toISOString() };
		}
	}

	@Get(':id/usage')
	@Roles('admin')
	usage(@Param('id') id: string, @Query('days') days?: string) {
		if (!this.registry.has(id)) throw new NotFoundException(`Provider "${id}" not registered`);
		const d = days ? Math.max(1, Math.min(90, parseInt(days, 10) || 7)) : 7;
		return {
			snapshot: this.rateLimit.snapshot(id),
			daily: this.rateLimit.dailyHistory(id, d),
			eventDaily: this.events.dailySummary(id, d),
		};
	}

	private summarise(p: Provider): ProviderSummary {
		return {
			id: p.id,
			displayName: p.displayName,
			description: p.description,
			capabilities: Array.from(p.capabilities),
			auth: p.auth,
			configFields: p.configFields,
			rateLimit: p.rateLimit,
			isConfigured: p.isConfigured(),
		};
	}
}

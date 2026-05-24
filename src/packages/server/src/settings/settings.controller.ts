import { networkInterfaces } from 'node:os';
import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import type { JwtUser } from '../common/permissions/index.js';
import { ConfigService } from '../config/config.service.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly configService: ConfigService,
	) {}

	/**
	 * Watch-tracking thresholds. Returned as the per-user merged values
	 * so a user override takes precedence over the app default. Share
	 * tokens get the app default (no user id available).
	 */
	@Get('playback')
	@RequireAction('view:library')
	getPlayback(@CurrentUser() user: JwtUser) {
		const userId = user?.role !== 'share' ? (user?.sub ?? user?.id ?? null) : null;
		return {
			watchedThresholdSeconds: this.settingsService.getForUser<number>(
				'playback.watchedThresholdSeconds',
				userId,
				this.settingsService.get<number>('watchedThresholdSeconds', 30),
			),
			completedTailSeconds: this.settingsService.getForUser<number>(
				'playback.completedTailSeconds',
				userId,
				this.settingsService.get<number>('completedTailSeconds', 300),
			),
		};
	}

	/**
	 * Aggregate read for the Settings > Matching page. Admin-only
	 * surface (the page already requires admin) so we can return the
	 * tuning knobs in one shot rather than ten round-trips. Returns
	 * defaults inline so the client doesn't need to duplicate them.
	 */
	@Get('matching')
	@Roles('admin')
	@RequireAction('view:app-settings')
	getMatching() {
		return {
			strategyWeights: this.settingsService.get<Record<string, number>>(
				'recommendations.strategyWeights',
				{
					'content-vector': 0.3,
					'external-cache': 0.3,
					embedding: 0.25,
					'llm-rerank': 0.15,
				},
			),
			mmrLambda: this.settingsService.get<number>('recommendations.mmrLambda', 0.7),
			qualityFloor: this.settingsService.get<number>(
				'recommendations.qualityFloor',
				0,
			),
			excludeSameGroup: this.settingsService.get<boolean>(
				'recommendations.excludeSameGroup',
				true,
			),
			excludeWatched: this.settingsService.get<boolean>(
				'recommendations.excludeWatched',
				false,
			),
			perDirectorCap: this.settingsService.get<number>(
				'recommendations.perDirectorCap',
				2,
			),
			multiInputPolicy: this.settingsService.get<'centroid' | 'union' | 'auto'>(
				'recommendations.multiInputPolicy',
				'auto',
			),
			autoEnrichExternalRecs: this.settingsService.get<boolean>(
				'recommendations.autoEnrichExternalRecs',
				true,
			),
			autoEnrichEmbeddings: this.settingsService.get<boolean>(
				'recommendations.autoEnrichEmbeddings',
				true,
			),
			autoEnrichLlmFeatures: this.settingsService.get<boolean>(
				'recommendations.autoEnrichLlmFeatures',
				true,
			),
		};
	}

	@Get('server-url')
	@Roles('admin')
	@RequireAction('admin:server')
	getServerUrl() {
		const port = this.configService.get<number>('server.port', 4000);
		const nets = networkInterfaces();
		let ip = '127.0.0.1';
		for (const addrs of Object.values(nets)) {
			if (!addrs) continue;
			for (const addr of addrs) {
				if (addr.family === 'IPv4' && !addr.internal) {
					ip = addr.address;
					break;
				}
			}
			if (ip !== '127.0.0.1') break;
		}
		return { url: `http://${ip}:${port}` };
	}

	@Get()
	@Roles('admin')
	@RequireAction('view:app-settings')
	getAll() {
		return this.settingsService.getAll();
	}

	@Get(':key')
	@Roles('admin')
	@RequireAction('view:app-settings')
	get(@Param('key') key: string) {
		const value = this.settingsService.get(key);
		return { key, value };
	}

	@Put(':key')
	@Roles('admin')
	@RequireAction('edit:app-settings')
	set(@Param('key') key: string, @Body() body: { value: unknown }) {
		this.settingsService.set(key, body.value);
		return { key, value: body.value };
	}

	@Put()
	@Roles('admin')
	@RequireAction('edit:app-settings')
	setBulk(@Body() body: Record<string, unknown>) {
		this.settingsService.setBulk(body);
		return { success: true };
	}

	@Delete(':key')
	@Roles('admin')
	@RequireAction('edit:app-settings')
	delete(@Param('key') key: string) {
		const deleted = this.settingsService.delete(key);
		return { success: deleted };
	}
}

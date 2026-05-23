import { networkInterfaces } from 'node:os';
import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ConfigService } from '../config/config.service.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly configService: ConfigService,
	) {}

	/**
	 * Subset of settings the regular SPA needs to render correctly
	 * (watch-tracking thresholds gate the resume UI). Read-only,
	 * non-admin — admins still write via PUT /:key.
	 */
	@Get('playback')
	getPlayback() {
		return {
			watchedThresholdSeconds: this.settingsService.get<number>(
				'watchedThresholdSeconds',
				30,
			),
			completedTailSeconds: this.settingsService.get<number>(
				'completedTailSeconds',
				300,
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
	getAll() {
		return this.settingsService.getAll();
	}

	@Get(':key')
	@Roles('admin')
	get(@Param('key') key: string) {
		const value = this.settingsService.get(key);
		return { key, value };
	}

	@Put(':key')
	@Roles('admin')
	set(@Param('key') key: string, @Body() body: { value: unknown }) {
		this.settingsService.set(key, body.value);
		return { key, value: body.value };
	}

	@Put()
	@Roles('admin')
	setBulk(@Body() body: Record<string, unknown>) {
		this.settingsService.setBulk(body);
		return { success: true };
	}

	@Delete(':key')
	@Roles('admin')
	delete(@Param('key') key: string) {
		const deleted = this.settingsService.delete(key);
		return { success: deleted };
	}
}

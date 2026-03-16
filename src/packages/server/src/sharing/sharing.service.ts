import { Injectable, Logger } from '@nestjs/common';
import { count } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { SettingsService } from '../settings/settings.service.js';
import type { SharingConfig } from './sharing-auth.guard.js';

const DEFAULT_SHARING: SharingConfig = {
	enabled: false,
	password: null,
	serverName: 'My Library',
};

@Injectable()
export class SharingService {
	private readonly logger = new Logger('SharingService');

	constructor(
		private readonly settings: SettingsService,
		private readonly database: DatabaseService,
	) {}

	getConfig(): SharingConfig {
		return this.settings.get<SharingConfig>('sharing', DEFAULT_SHARING);
	}

	setConfig(config: Partial<SharingConfig>): SharingConfig {
		const current = this.getConfig();
		const updated = { ...current, ...config };
		this.settings.set('sharing', updated);
		this.logger.log(`Sharing config updated: enabled=${updated.enabled}`);
		return updated;
	}

	getMovieCount(): number {
		const result = this.database.db.select({ count: count() }).from(movies).get();
		return result?.count ?? 0;
	}
}

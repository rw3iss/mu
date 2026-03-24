import {
	DEFAULT_DARK_CONFIG,
	DEFAULT_LIGHT_CONFIG,
	nowISO,
	type ThemeConfig,
	type ThemeRecord,
	validateThemeConfig,
} from '@mu/shared';
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleInit,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { type Theme, themes } from '../database/schema/index.js';

@Injectable()
export class ThemesService implements OnModuleInit {
	private readonly logger = new Logger('ThemesService');
	private cache = new Map<string, ThemeRecord>();

	constructor(private readonly database: DatabaseService) {}

	async onModuleInit() {
		await this.seedDefaults();
		this.refreshCache();
	}

	findAll(): ThemeRecord[] {
		return Array.from(this.cache.values());
	}

	findOne(id: string): ThemeRecord {
		const theme = this.cache.get(id);
		if (!theme) throw new NotFoundException('Theme not found');
		return theme;
	}

	create(data: {
		name: string;
		mode: 'dark' | 'light';
		config: ThemeConfig;
		isDefault?: boolean;
		createdBy?: string;
	}): ThemeRecord {
		if (!validateThemeConfig(data.config)) {
			throw new BadRequestException('Invalid theme config');
		}

		const now = nowISO();
		const id = crypto.randomUUID();

		if (data.isDefault) {
			this.clearDefaults(data.mode);
		}

		this.database.db
			.insert(themes)
			.values({
				id,
				name: data.name,
				mode: data.mode,
				config: JSON.stringify(data.config),
				isDefault: data.isDefault ? 1 : 0,
				createdBy: data.createdBy ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		this.refreshCache();
		return this.findOne(id);
	}

	update(
		id: string,
		data: {
			name?: string;
			mode?: 'dark' | 'light';
			config?: ThemeConfig;
			isDefault?: boolean;
		},
	): ThemeRecord {
		const existing = this.findOne(id);

		if (data.config && !validateThemeConfig(data.config)) {
			throw new BadRequestException('Invalid theme config');
		}

		const now = nowISO();

		if (data.isDefault) {
			this.clearDefaults(data.mode ?? existing.mode);
		}

		this.database.db
			.update(themes)
			.set({
				...(data.name !== undefined && { name: data.name }),
				...(data.mode !== undefined && { mode: data.mode }),
				...(data.config !== undefined && { config: JSON.stringify(data.config) }),
				...(data.isDefault !== undefined && { isDefault: data.isDefault ? 1 : 0 }),
				updatedAt: now,
			})
			.where(eq(themes.id, id))
			.run();

		this.refreshCache();
		return this.findOne(id);
	}

	remove(id: string): void {
		this.findOne(id); // ensure exists
		this.database.db.delete(themes).where(eq(themes.id, id)).run();
		this.refreshCache();
	}

	importTheme(data: { name: string; mode: 'dark' | 'light'; config: unknown }): ThemeRecord {
		if (!validateThemeConfig(data.config)) {
			throw new BadRequestException('Invalid theme config in import data');
		}

		return this.create({
			name: data.name,
			mode: data.mode,
			config: data.config,
		});
	}

	exportTheme(id: string): {
		name: string;
		mode: string;
		config: ThemeConfig;
		exportedAt: string;
	} {
		const theme = this.findOne(id);
		return {
			name: theme.name,
			mode: theme.mode,
			config: theme.config,
			exportedAt: nowISO(),
		};
	}

	private clearDefaults(mode: string) {
		const now = nowISO();
		this.database.db
			.update(themes)
			.set({ isDefault: 0, updatedAt: now })
			.where(eq(themes.mode, mode))
			.run();
	}

	private async seedDefaults() {
		const existing = this.database.db.select().from(themes).all();
		if (existing.length > 0) return;

		this.logger.log('Seeding default themes');
		const now = nowISO();

		this.database.db
			.insert(themes)
			.values([
				{
					id: crypto.randomUUID(),
					name: 'Default Dark',
					mode: 'dark',
					config: JSON.stringify(DEFAULT_DARK_CONFIG),
					isDefault: 1,
					createdBy: null,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: crypto.randomUUID(),
					name: 'Default Light',
					mode: 'light',
					config: JSON.stringify(DEFAULT_LIGHT_CONFIG),
					isDefault: 1,
					createdBy: null,
					createdAt: now,
					updatedAt: now,
				},
			])
			.run();
	}

	private refreshCache() {
		this.cache.clear();
		const rows = this.database.db.select().from(themes).all();
		for (const row of rows) {
			this.cache.set(row.id, this.toRecord(row));
		}
	}

	private toRecord(row: Theme): ThemeRecord {
		return {
			id: row.id,
			name: row.name,
			mode: row.mode as 'dark' | 'light',
			config: JSON.parse(row.config) as ThemeConfig,
			isDefault: row.isDefault === 1,
			createdBy: row.createdBy,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

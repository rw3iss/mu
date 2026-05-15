import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

interface CatalogueEntry {
	name: string;
	mode: 'dark' | 'light';
	description?: string;
	isDefault?: boolean;
	config: ThemeConfig;
}

/**
 * Attempt to load the curated theme catalogue. Tries a few candidate
 * paths to handle both dev (running from source) and production (built
 * dist next to compiled JS). Returns null if no catalogue is found —
 * caller falls back to the minimal two-theme seed.
 */
function loadCatalogue(logger: Logger): CatalogueEntry[] | null {
	const candidates = [
		// Dev: server cwd -> ../client/src/styles/themes/catalogue.json
		resolve(process.cwd(), '../client/src/styles/themes/catalogue.json'),
		// Monorepo root: <root>/src/packages/client/src/styles/themes/catalogue.json
		resolve(process.cwd(), 'src/packages/client/src/styles/themes/catalogue.json'),
		resolve(process.cwd(), 'packages/client/src/styles/themes/catalogue.json'),
		// From a built server dist nearby
		resolve(process.cwd(), '../../client/src/styles/themes/catalogue.json'),
	];
	for (const p of candidates) {
		try {
			const raw = readFileSync(p, 'utf-8');
			const json = JSON.parse(raw);
			if (Array.isArray(json?.themes)) return json.themes as CatalogueEntry[];
		} catch {
			// try next
		}
	}
	logger.debug('Curated theme catalogue not found; falling back to defaults');
	return null;
}

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
		// Back-compat: rename legacy "Default Dark/Light" rows to their
		// new catalogue names so users keep their saved selection. Skip
		// if a row with the new name already exists (idempotent).
		const renames: Array<{ from: string; to: string }> = [
			{ from: 'Default (Dark)', to: 'Midnight Reel' },
			{ from: 'Default Dark', to: 'Midnight Reel' },
			{ from: 'Default (Light)', to: 'Daylight' },
			{ from: 'Default Light', to: 'Daylight' },
		];
		for (const r of renames) {
			const hasNew = this.database.db
				.select()
				.from(themes)
				.where(eq(themes.name, r.to))
				.all();
			if (hasNew.length > 0) continue;
			const hasOld = this.database.db
				.select()
				.from(themes)
				.where(eq(themes.name, r.from))
				.all();
			if (hasOld.length === 0) continue;
			this.database.db
				.update(themes)
				.set({ name: r.to, updatedAt: nowISO() })
				.where(eq(themes.name, r.from))
				.run();
		}

		// Idempotent: insert any catalogue entry whose name isn't in the
		// DB yet. Re-runs are safe; user edits to a same-named row are
		// preserved (we never overwrite existing rows).
		const existingRows = this.database.db.select().from(themes).all();
		const existingNames = new Set(existingRows.map((r) => r.name));

		const catalogue = loadCatalogue(this.logger);
		if (catalogue && catalogue.length > 0) {
			const toInsert = catalogue.filter((t) => !existingNames.has(t.name));
			if (toInsert.length === 0) return;
			this.logger.log(`Seeding ${toInsert.length} curated theme(s)`);
			const now = nowISO();
			this.database.db
				.insert(themes)
				.values(
					toInsert.map((t) => ({
						id: crypto.randomUUID(),
						name: t.name,
						mode: t.mode,
						config: JSON.stringify(t.config),
						isDefault: t.isDefault ? 1 : 0,
						createdBy: null,
						createdAt: now,
						updatedAt: now,
					})),
				)
				.run();
			return;
		}

		// No catalogue available — minimal fallback (fresh boot, no client tree).
		if (existingRows.length > 0) return;
		this.logger.log('Seeding minimal default themes');
		const now = nowISO();
		this.database.db
			.insert(themes)
			.values([
				{
					id: crypto.randomUUID(),
					name: 'Midnight Reel',
					mode: 'dark',
					config: JSON.stringify(DEFAULT_DARK_CONFIG),
					isDefault: 1,
					createdBy: null,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: crypto.randomUUID(),
					name: 'Daylight',
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

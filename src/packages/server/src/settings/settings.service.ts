import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { settings } from '../database/schema/index.js';

@Injectable()
export class SettingsService {
	private readonly logger = new Logger('SettingsService');

	constructor(private readonly database: DatabaseService) {}

	getAll(): Record<string, unknown> {
		const rows = this.database.db.select().from(settings).all();
		const result: Record<string, unknown> = {};
		for (const row of rows) {
			try {
				result[row.key] = JSON.parse(row.value ?? '');
			} catch {
				result[row.key] = row.value;
			}
		}
		return result;
	}

	get<T = unknown>(key: string, defaultValue?: T): T {
		const row = this.database.db.select().from(settings).where(eq(settings.key, key)).get();

		if (!row) {
			return defaultValue as T;
		}

		try {
			return JSON.parse(row.value ?? '') as T;
		} catch {
			return (row.value ?? '') as T;
		}
	}

	set(key: string, value: unknown): void {
		const serialized = typeof value === 'string' ? value : JSON.stringify(value);
		const now = nowISO();

		const existing = this.database.db
			.select()
			.from(settings)
			.where(eq(settings.key, key))
			.get();

		if (existing) {
			this.database.db
				.update(settings)
				.set({ value: serialized, updatedAt: now })
				.where(eq(settings.key, key))
				.run();
		} else {
			this.database.db
				.insert(settings)
				.values({
					key,
					value: serialized,
					updatedAt: now,
				})
				.run();
		}

		this.logger.debug(`Setting updated: ${key}`);
	}

	delete(key: string): boolean {
		const result = this.database.db.delete(settings).where(eq(settings.key, key)).run();
		return result.changes > 0;
	}

	getBulk(keys: string[]): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const key of keys) {
			result[key] = this.get(key);
		}
		return result;
	}

	setBulk(entries: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(entries)) {
			this.set(key, value);
		}
	}
}

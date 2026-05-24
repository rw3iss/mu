import { isUserSettingKey, nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { settings, userSettings } from '../database/schema/index.js';
import { UserSettingsCache } from './user-settings-cache.js';

@Injectable()
export class SettingsService {
	private readonly logger = new Logger('SettingsService');
	private readonly userCache = new UserSettingsCache();

	constructor(private readonly database: DatabaseService) {}

	// --- App-wide settings ------------------------------------------------

	getAll(): Record<string, unknown> {
		const rows = this.database.db.select().from(settings).all();
		const result: Record<string, unknown> = {};
		for (const row of rows) {
			result[row.key] = this.parseValue(row.value);
		}
		return result;
	}

	get<T = unknown>(key: string, defaultValue?: T): T {
		const row = this.database.db.select().from(settings).where(eq(settings.key, key)).get();
		if (!row) return defaultValue as T;
		return this.parseValue(row.value) as T;
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
				.values({ key, value: serialized, updatedAt: now })
				.run();
		}

		// App-wide values feed every user's fallback. Drop all per-user
		// caches so the next read recomputes the merge.
		this.userCache.invalidateAll();
		this.logger.debug(`Setting updated: ${key}`);
	}

	delete(key: string): boolean {
		const result = this.database.db.delete(settings).where(eq(settings.key, key)).run();
		this.userCache.invalidateAll();
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

	// --- Per-user settings ------------------------------------------------

	/**
	 * Read a setting for a specific user.
	 * Resolution order: user_settings → settings → defaultValue.
	 */
	getForUser<T = unknown>(key: string, userId: string | null, defaultValue?: T): T {
		if (userId) {
			const row = this.database.db
				.select()
				.from(userSettings)
				.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
				.get();
			if (row) return this.parseValue(row.value) as T;
		}
		return this.get<T>(key, defaultValue);
	}

	/**
	 * Merged map (app + user overrides) for one user. Cached.
	 *
	 * NB: only keys that exist in either `settings` or `user_settings`
	 * appear here. Default values for unset keys come from the consuming
	 * code via `getForUser(key, userId, default)`.
	 */
	getAllForUser(userId: string): Record<string, unknown> {
		const cached = this.userCache.get(userId);
		if (cached) return cached;

		const merged: Record<string, unknown> = { ...this.getAll() };
		const overrides = this.database.db
			.select()
			.from(userSettings)
			.where(eq(userSettings.userId, userId))
			.all();
		for (const row of overrides) {
			merged[row.key] = this.parseValue(row.value);
		}
		this.userCache.set(userId, merged);
		return merged;
	}

	/**
	 * Returns ONLY the overrides this user has set (no app fallback).
	 * Used by the admin "edit user's overrides" drawer.
	 */
	getUserOverrides(userId: string): Record<string, unknown> {
		const overrides = this.database.db
			.select()
			.from(userSettings)
			.where(eq(userSettings.userId, userId))
			.all();
		const result: Record<string, unknown> = {};
		for (const row of overrides) {
			result[row.key] = this.parseValue(row.value);
		}
		return result;
	}

	/**
	 * Write a per-user setting. Caller must already have permission-checked
	 * `targetUserId` (self or `admin:any-user-setting`).
	 *
	 * @param skipAllowlist set true when the caller has `admin:any-user-setting`.
	 */
	setForUser(key: string, value: unknown, userId: string, skipAllowlist = false): void {
		if (!skipAllowlist && !isUserSettingKey(key)) {
			throw new Error(`Key not user-overridable: ${key}`);
		}
		const serialized = typeof value === 'string' ? value : JSON.stringify(value);
		const now = nowISO();

		const existing = this.database.db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
			.get();

		if (existing) {
			this.database.db
				.update(userSettings)
				.set({ value: serialized, updatedAt: now })
				.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
				.run();
		} else {
			this.database.db
				.insert(userSettings)
				.values({ userId, key, value: serialized, updatedAt: now })
				.run();
		}

		this.userCache.invalidate(userId);
		this.logger.debug(`User setting updated: ${userId}.${key}`);
	}

	/** Drop a per-user override, reverting to the app default. */
	deleteForUser(key: string, userId: string): boolean {
		const result = this.database.db
			.delete(userSettings)
			.where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
			.run();
		this.userCache.invalidate(userId);
		return result.changes > 0;
	}

	/** Drop every override for a user. Called on user delete. */
	clearUser(userId: string): void {
		this.database.db.delete(userSettings).where(eq(userSettings.userId, userId)).run();
		this.userCache.invalidate(userId);
	}

	// ---------------------------------------------------------------------

	private parseValue(raw: string | null | undefined): unknown {
		if (raw == null) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}
}

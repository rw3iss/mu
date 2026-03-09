import { api } from './api';

// ============================================
// Settings Service
// ============================================

export const settingsService = {
	/**
	 * Get all application settings as a key-value map.
	 */
	getAll(): Promise<Record<string, unknown>> {
		return api.get<Record<string, unknown>>('/settings');
	},

	/**
	 * Get a single setting value by its key.
	 * @param key - The setting key to retrieve.
	 */
	get(key: string): Promise<unknown> {
		return api.get<unknown>(`/settings/${key}`);
	},

	/**
	 * Set a single setting value.
	 * @param key - The setting key to update.
	 * @param value - The new value for the setting.
	 */
	set(key: string, value: unknown): Promise<void> {
		return api.put<void>(`/settings/${key}`, { value });
	},

	/**
	 * Set multiple settings at once.
	 * @param settings - A key-value map of settings to update.
	 */
	setBulk(settings: Record<string, unknown>): Promise<void> {
		return api.put<void>('/settings', settings);
	},

	/**
	 * Remove a setting by its key, resetting it to its default value.
	 * @param key - The setting key to remove.
	 */
	remove(key: string): Promise<void> {
		return api.delete<void>(`/settings/${key}`);
	},
};

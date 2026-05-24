import { api } from './api';

// ============================================
// Settings Service
// ============================================

export const settingsService = {
	// --- App-wide (admin only) -----------------------------------------

	/** Get all application settings as a key-value map. (admin) */
	getAll(): Promise<Record<string, unknown>> {
		return api.get<Record<string, unknown>>('/settings');
	},

	/** Get a single application setting by its key. (admin) */
	get(key: string): Promise<unknown> {
		return api.get<unknown>(`/settings/${key}`);
	},

	/** Set a single application setting. (admin) */
	set(key: string, value: unknown): Promise<void> {
		return api.put<void>(`/settings/${key}`, { value });
	},

	/** Bulk-set application settings. (admin) */
	setBulk(settings: Record<string, unknown>): Promise<void> {
		return api.put<void>('/settings', settings);
	},

	/** Remove an application setting. (admin) */
	remove(key: string): Promise<void> {
		return api.delete<void>(`/settings/${key}`);
	},

	// --- Per-user -------------------------------------------------------

	/** Get current user's merged settings (app defaults + own overrides). */
	getMine(): Promise<Record<string, unknown>> {
		return api.get<Record<string, unknown>>('/settings/me');
	},

	/** Write a single override for the current user. Allowlist enforced server-side. */
	setMine(key: string, value: unknown): Promise<void> {
		return api.put<void>(`/settings/me/${key}`, { value });
	},

	/** Drop a single override, reverting to the app default. */
	removeMine(key: string): Promise<void> {
		return api.delete<void>(`/settings/me/${key}`);
	},

	// --- Admin: manage another user's overrides -------------------------

	getUserSettings(
		userId: string,
	): Promise<{ overrides: Record<string, unknown>; merged: Record<string, unknown> }> {
		return api.get(`/users/${userId}/settings`);
	},

	setUserSetting(userId: string, key: string, value: unknown): Promise<void> {
		return api.put<void>(`/users/${userId}/settings/${key}`, { value });
	},

	removeUserSetting(userId: string, key: string): Promise<void> {
		return api.delete<void>(`/users/${userId}/settings/${key}`);
	},
};

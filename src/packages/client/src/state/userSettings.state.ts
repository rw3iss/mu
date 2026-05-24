import { signal } from '@preact/signals';
import { settingsService } from '@/services/settings.service';

/**
 * Current user's merged settings (app defaults + their own overrides).
 *
 * Boot fetch happens after login; reads via `useSetting(key, default)`.
 * Writes go through `setMine(key, value)` and update the signal
 * optimistically.
 */
export const userSettings = signal<Record<string, unknown>>({});
export const userSettingsReady = signal(false);

let inFlight: Promise<void> | null = null;

export async function fetchUserSettings(): Promise<void> {
	if (inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const data = await settingsService.getMine();
			userSettings.value = data ?? {};
			userSettingsReady.value = true;
		} catch {
			// Not authed yet, or share-token request — keep empty map.
			userSettings.value = {};
			userSettingsReady.value = false;
		}
	})();
	try {
		await inFlight;
	} finally {
		inFlight = null;
	}
}

export async function setMine(key: string, value: unknown): Promise<void> {
	// Optimistic update
	userSettings.value = { ...userSettings.value, [key]: value };
	try {
		await settingsService.setMine(key, value);
	} catch (err) {
		// Roll back by re-fetching authoritative state
		await fetchUserSettings();
		throw err;
	}
}

export async function clearMine(key: string): Promise<void> {
	const next = { ...userSettings.value };
	delete next[key];
	userSettings.value = next;
	try {
		await settingsService.removeMine(key);
	} catch (err) {
		await fetchUserSettings();
		throw err;
	}
}

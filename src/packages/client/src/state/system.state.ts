import { signal } from '@preact/signals';
import { profileService } from '@/services/profile.service';

/**
 * Server-controlled system flags the client needs to react to. Currently just
 * the admin "Show Users Info" master switch that gates the Members sidebar item,
 * the Members page, and the per-user "Show Profile Info" toggle.
 */
export const showUsersInfo = signal(false);

/** Whether the config has been fetched at least once (avoids UI flicker). */
export const systemConfigLoaded = signal(false);

/** Load the system config once the user is authenticated. Safe to call again. */
export async function loadSystemConfig(): Promise<void> {
	try {
		const config = await profileService.getSystemConfig();
		showUsersInfo.value = config.showUsersInfo === true;
	} catch {
		// Not authed yet, or endpoint unavailable — keep the safe default (off).
	} finally {
		systemConfigLoaded.value = true;
	}
}

/** Reflect an admin's local toggle immediately (server already persisted it). */
export function setShowUsersInfoLocal(value: boolean): void {
	showUsersInfo.value = !!value;
}

/** Reset on logout so the next user starts clean. */
export function resetSystemConfig(): void {
	showUsersInfo.value = false;
	systemConfigLoaded.value = false;
}

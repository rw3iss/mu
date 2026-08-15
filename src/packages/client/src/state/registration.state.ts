import { DEFAULT_REGISTRATION_CONFIG, type RegistrationConfig } from '@mu/shared';
import { signal } from '@preact/signals';
import { authService } from '@/services/auth.service';

/**
 * The server's self-registration switches. Fetched on the auth screens (which
 * run signed-out) so /login knows whether to offer "Register a new account" and
 * /register knows which confirmation copy applies.
 *
 * Defaults to registration OFF so a failed/slow fetch never advertises sign-up
 * on an installation that has it disabled.
 */
export const registrationConfig = signal<RegistrationConfig>({ ...DEFAULT_REGISTRATION_CONFIG });

/** True once fetched at least once — lets the UI avoid flashing the button. */
export const registrationConfigLoaded = signal(false);

let inFlight: Promise<void> | null = null;

/**
 * Load the config once. Safe to call from several places (login + register
 * mount) — concurrent callers share the same request, and the cached value is
 * served immediately on later calls.
 */
export async function loadRegistrationConfig(force = false): Promise<void> {
	if (registrationConfigLoaded.value && !force) return;
	if (inFlight) return inFlight;

	inFlight = authService
		.getRegistrationConfig()
		.then((config) => {
			registrationConfig.value = {
				allowRegistration: config.allowRegistration === true,
				requireApproval: config.requireApproval === true,
				requireEmailVerification: config.requireEmailVerification === true,
			};
		})
		.catch(() => {
			// Endpoint unavailable — keep the safe default (registration off).
		})
		.finally(() => {
			registrationConfigLoaded.value = true;
			inFlight = null;
		});

	return inFlight;
}

/** Reflect an admin's toggle immediately (the server already persisted it). */
export function setRegistrationConfigLocal(config: RegistrationConfig): void {
	registrationConfig.value = { ...config };
	registrationConfigLoaded.value = true;
}

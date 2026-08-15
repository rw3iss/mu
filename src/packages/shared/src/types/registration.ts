/**
 * Self-registration: admin-controlled sign-up for new accounts.
 *
 * Lives in `@mu/shared` because BOTH sides need the same contract — the client
 * shows/hides the register UI and pre-validates the password, and the server
 * enforces the identical rules. Never fork these values per side.
 */

/** Admin switches from Settings → Users. */
export interface RegistrationConfig {
	/** Master switch. When false there is no public sign-up at all. */
	allowRegistration: boolean;
	/** New accounts stay inactive until an admin approves them. */
	requireApproval: boolean;
	/** New accounts must click a link in a verification email before signing in. */
	requireEmailVerification: boolean;
}

/** Registration is OFF by default — an installation must opt in. */
export const DEFAULT_REGISTRATION_CONFIG: RegistrationConfig = {
	allowRegistration: false,
	requireApproval: true,
	requireEmailVerification: false,
};

/**
 * What the new account needs before it can sign in. Drives the confirmation
 * copy on the register page.
 */
export type RegistrationStatus =
	| 'active'
	| 'pending-approval'
	| 'pending-verification'
	| 'pending-verification-and-approval';

export interface RegistrationResult {
	status: RegistrationStatus;
	/** Human-readable next step, rendered verbatim by the client. */
	message: string;
	username: string;
}

// ── Password policy (shared by the register form and the server) ────────────

/**
 * Registration's own minimum — deliberately stricter than the legacy
 * `PASSWORD_MIN_LENGTH` (6) used by the self-service change form in
 * `profile.ts`, which is left alone so existing users aren't affected.
 */
export const REGISTRATION_PASSWORD_MIN_LENGTH = 8;

/** Shown under the password field and in server-side error text. */
export const PASSWORD_RULE_TEXT =
	'At least 8 characters, including an uppercase letter, a lowercase letter, and a number.';

/**
 * Validate a password against the registration policy. Returns an error string,
 * or null when the password is acceptable.
 */
export function validatePassword(password: string): string | null {
	if (!password || password.length < REGISTRATION_PASSWORD_MIN_LENGTH) {
		return `Password must be at least ${REGISTRATION_PASSWORD_MIN_LENGTH} characters.`;
	}
	if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
	if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
	if (!/[0-9]/.test(password)) return 'Password must include a number.';
	return null;
}

// ── Username / email ───────────────────────────────────────────────────────

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
/** Letters, numbers, dot, dash, underscore — keeps usernames URL-safe. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function validateUsername(username: string): string | null {
	const value = (username ?? '').trim();
	if (value.length < USERNAME_MIN_LENGTH) {
		return `Username must be at least ${USERNAME_MIN_LENGTH} characters.`;
	}
	if (value.length > USERNAME_MAX_LENGTH) {
		return `Username must be at most ${USERNAME_MAX_LENGTH} characters.`;
	}
	if (!USERNAME_PATTERN.test(value)) {
		return 'Username may only contain letters, numbers, dots, dashes, and underscores.';
	}
	return null;
}

export function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email ?? '').trim());
}

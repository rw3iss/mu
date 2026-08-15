import {
	REGISTRATION_PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from '@mu/shared';
import { z } from 'zod';

/**
 * Public self-registration payload. Shape-level checks only — the password
 * POLICY (upper/lower/number) is enforced by the shared `validatePassword` in
 * RegistrationService so the client and server can never drift.
 */
export const registerSchema = z.object({
	username: z
		.string()
		.trim()
		.min(USERNAME_MIN_LENGTH)
		.max(USERNAME_MAX_LENGTH)
		.regex(USERNAME_PATTERN),
	email: z.string().trim().email(),
	displayName: z.string().trim().max(80).optional(),
	password: z.string().min(REGISTRATION_PASSWORD_MIN_LENGTH),
});

export type RegisterDto = z.infer<typeof registerSchema>;

/** Admin update of the registration switches (Settings → Users). */
export const registrationConfigSchema = z.object({
	allowRegistration: z.boolean(),
	requireApproval: z.boolean(),
	requireEmailVerification: z.boolean(),
});

export type RegistrationConfigDto = z.infer<typeof registrationConfigSchema>;

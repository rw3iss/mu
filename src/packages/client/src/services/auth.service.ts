import type { RegistrationConfig, RegistrationResult } from '@mu/shared';
import { api } from './api';

/**
 * Auth endpoints that aren't part of the session lifecycle (login/logout live in
 * `state/auth.state.ts`): the self-registration config, sign-up, and email
 * verification. Components depend on this, never on the transport.
 */
export const authService = {
	/** Public — readable while signed out so /login can show the register link. */
	getRegistrationConfig(): Promise<RegistrationConfig> {
		return api.get<RegistrationConfig>('/auth/registration-config');
	},

	/** Admin — persist the three registration switches. */
	setRegistrationConfig(config: RegistrationConfig): Promise<RegistrationConfig> {
		return api.put<RegistrationConfig>('/auth/registration-config', config);
	},

	register(data: {
		username: string;
		email: string;
		displayName?: string;
		password: string;
	}): Promise<RegistrationResult> {
		return api.post<RegistrationResult>('/auth/register', data);
	},

	verifyEmail(token: string): Promise<{ verified: boolean; pendingApproval: boolean }> {
		return api.get<{ verified: boolean; pendingApproval: boolean }>(
			`/auth/verify-email?token=${encodeURIComponent(token)}`,
		);
	},
};

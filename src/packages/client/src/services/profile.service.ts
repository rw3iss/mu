import type {
	MemberSummary,
	ProfileSystemConfig,
	ProfileView,
	UpdateProfileInput,
} from '@mu/shared';
import { api } from './api';

/**
 * Profile + Members API. Backs the /profile (edit + public view) and /members
 * pages and the admin "Show Users Info" system toggle. All access goes through
 * here — components never call `api` directly (see BUILD.md → Data & API).
 */
export const profileService = {
	/** The current user's own editable profile. */
	getMine(): Promise<ProfileView> {
		return api.get<ProfileView>('/profile/me');
	},

	/** A public read view of another user (404 if not visible to the requester). */
	getByUsername(username: string): Promise<ProfileView> {
		return api.get<ProfileView>(`/profile/${encodeURIComponent(username)}`);
	},

	/** Update the current user's editable profile fields. */
	updateMine(patch: UpdateProfileInput): Promise<ProfileView> {
		return api.patch<ProfileView>('/profile/me', patch);
	},

	/** Upload a new avatar image (multipart). Returns the refreshed profile. */
	async uploadAvatar(file: File): Promise<ProfileView> {
		const form = new FormData();
		form.append('avatar', file);
		const token = localStorage.getItem('mu_token');
		const res = await fetch('/api/v1/profile/me/avatar', {
			method: 'POST',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: form,
			credentials: 'include',
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}) as Record<string, unknown>);
			throw new Error(
				(body as { message?: string }).message || `Upload failed: ${res.status}`,
			);
		}
		return res.json();
	},

	/** Change the current user's password. */
	changePassword(newPassword: string): Promise<{ ok: boolean }> {
		return api.post<{ ok: boolean }>('/profile/me/password', { newPassword });
	},

	/** Read the admin master switch (any authed user). */
	getSystemConfig(): Promise<ProfileSystemConfig> {
		return api.get<ProfileSystemConfig>('/profile/config');
	},

	/** Admin: toggle the master switch. */
	setSystemConfig(showUsersInfo: boolean): Promise<ProfileSystemConfig> {
		return api.put<ProfileSystemConfig>('/profile/config', { showUsersInfo });
	},

	/** The Members directory (gated for non-admins by the master switch). */
	listMembers(): Promise<{ members: MemberSummary[] }> {
		return api.get<{ members: MemberSummary[] }>('/members');
	},
};

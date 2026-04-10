import { api } from './api';

export interface CreateShareLinkResponse {
	token: string;
	movieId: string;
	expiresInDays: number | null;
}

export interface VerifyShareLinkResponse {
	valid: boolean;
	movieId?: string;
}

export const shareLinksService = {
	/**
	 * Create a share token + URL for the given movie. Requires a logged-in user.
	 */
	create(movieId: string): Promise<CreateShareLinkResponse> {
		return api.post<CreateShareLinkResponse>('/share-links', { movieId });
	},

	/**
	 * Verify a share token. No auth required — safe to call from the public watch page.
	 */
	verify(token: string): Promise<VerifyShareLinkResponse> {
		return api.get<VerifyShareLinkResponse>(`/share-links/verify/${encodeURIComponent(token)}`);
	},

	/**
	 * Build the public share URL for a token, relative to the current origin.
	 */
	buildUrl(token: string): string {
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		return `${origin}/watch/${token}`;
	},
};

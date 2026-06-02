import type { ThemeRecord } from '@mu/shared';
import { api } from './api';

export const themesApi = {
	list: () => api.get<ThemeRecord[]>('/themes'),
	get: (id: string) => api.get<ThemeRecord>(`/themes/${id}`),
	create: (data: { name: string; mode: string; config: unknown }) =>
		api.post<ThemeRecord>('/themes', data),
	update: (id: string, data: { name?: string; mode?: string; config?: unknown }) =>
		api.put<ThemeRecord>(`/themes/${id}`, data),
	remove: (id: string) => api.delete(`/themes/${id}`),
	importTheme: (data: unknown) => api.post<ThemeRecord>('/themes/import', data),
	// Opened via window.open(), which can't send the Authorization header —
	// so the JWT rides along as a `?token=` query param (same pattern HLS.js /
	// EventSource use; the auth guard checks `?token=` before cookies).
	exportUrl: (id: string) => {
		const token = localStorage.getItem('mu_token');
		const q = token ? `?token=${encodeURIComponent(token)}` : '';
		return `/api/v1/themes/${id}/export${q}`;
	},
};

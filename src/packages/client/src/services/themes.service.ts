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
	exportUrl: (id: string) => `/api/v1/themes/${id}/export`,
};

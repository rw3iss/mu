import type { NotificationDto } from '@mu/shared';
import { api } from './api';

export const notificationsApi = {
	list(page = 1, pageSize = 30): Promise<{ notifications: NotificationDto[]; hasMore: boolean }> {
		return api.get('/notifications', { page: String(page), pageSize: String(pageSize) });
	},
	unreadCount(): Promise<{ count: number }> {
		return api.get('/notifications/unread-count');
	},
	markRead(id: string): Promise<{ ok: boolean }> {
		return api.post(`/notifications/${id}/read`);
	},
	markAllRead(): Promise<{ ok: boolean }> {
		return api.post('/notifications/read-all');
	},
	remove(id: string): Promise<{ ok: boolean }> {
		return api.delete(`/notifications/${id}`);
	},
};

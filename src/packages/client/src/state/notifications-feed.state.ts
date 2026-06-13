import type { NotificationDto } from '@mu/shared';
import { signal } from '@preact/signals';
import { notificationsApi } from '@/services/notifications-api.service';
import { wsService } from '@/services/websocket.service';
import { formatNotification } from '@/utils/notification-format';
import { currentUser } from './auth.state';
import { notifyInfo } from './notifications.state';

/** The current user's notifications (their own + system-wide), newest first. */
export const notifications = signal<NotificationDto[]>([]);
export const notificationsUnread = signal<number>(0);
export const notificationsLoading = signal<boolean>(false);
export const notificationsHasMore = signal<boolean>(false);

let page = 1;
let initialized = false;

function recountUnread(): void {
	notificationsUnread.value = notifications.value.filter((n) => !n.read).length;
}

export async function loadNotifications(reset = true): Promise<void> {
	if (reset) page = 1;
	notificationsLoading.value = true;
	try {
		const r = await notificationsApi.list(page, 30);
		notifications.value = reset
			? r.notifications
			: [...notifications.value, ...r.notifications];
		notificationsHasMore.value = r.hasMore;
		recountUnread();
	} catch {
		// non-critical
	} finally {
		notificationsLoading.value = false;
	}
}

export async function loadMoreNotifications(): Promise<void> {
	if (!notificationsHasMore.value || notificationsLoading.value) return;
	page += 1;
	await loadNotifications(false);
}

export async function markNotificationRead(id: string): Promise<void> {
	const n = notifications.value.find((x) => x.id === id);
	if (!n || n.read) return;
	notifications.value = notifications.value.map((x) => (x.id === id ? { ...x, read: true } : x));
	recountUnread();
	await notificationsApi.markRead(id).catch(() => {});
}

export async function markAllNotificationsRead(): Promise<void> {
	notifications.value = notifications.value.map((n) => ({ ...n, read: true }));
	notificationsUnread.value = 0;
	await notificationsApi.markAllRead().catch(() => {});
}

export async function removeNotification(id: string): Promise<void> {
	notifications.value = notifications.value.filter((n) => n.id !== id);
	recountUnread();
	await notificationsApi.remove(id).catch(() => {});
}

/**
 * Initialise the live notification feed: load existing + subscribe to the WS
 * 'notification' channel (registering our userId so the server routes only our
 * own + system-wide ones). New ones prepend and pop a toast.
 */
export function initNotifications(): void {
	if (initialized) return;
	initialized = true;

	loadNotifications();

	wsService.subscribe('notification');
	const uid = currentUser.value?.id;
	if (uid) wsService.send('register', { userId: uid });

	wsService.on('notification', (data: unknown) => {
		const n = data as NotificationDto;
		if (!n || typeof n.id !== 'string') return;
		// Ours or system-wide only (server already routes, but double-check).
		const me = currentUser.value?.id;
		if (n.userId && n.userId !== me) return;
		if (notifications.value.some((x) => x.id === n.id)) return;
		notifications.value = [n, ...notifications.value];
		recountUnread();
		const f = formatNotification(n);
		notifyInfo(`${f.icon ? `${f.icon} ` : ''}${f.message}`, 6000);
	});
}

/** Re-register our userId after a (re)connect or user change. */
export function reregisterNotifications(): void {
	const uid = currentUser.value?.id;
	if (uid) wsService.send('register', { userId: uid });
}

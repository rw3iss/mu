import type { NotificationDto } from '@mu/shared';
import { signal } from '@preact/signals';
import { notificationsApi } from '@/services/notifications-api.service';
import { socketManager } from '@/services/socket-manager';
import { formatNotification } from '@/utils/notification-format';
import { currentUser } from './auth.state';
import { notifyInfo, shouldNotifyComments } from './notifications.state';

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

	// The socket manager owns the global + per-user channels; we just delegate
	// the 'notification' event. The server routes by channel (user:<id> for
	// personal, global for system-wide), so anything that arrives here is ours.
	socketManager.on('notification', (data: unknown) => {
		const n = data as NotificationDto;
		if (!n || typeof n.id !== 'string') return;
		const me = currentUser.value?.id;
		if (n.userId && n.userId !== me) return; // belt-and-suspenders
		if (notifications.value.some((x) => x.id === n.id)) return;
		notifications.value = [n, ...notifications.value];
		recountUnread();
		// The panel always updates; the TOAST for comment reply/reaction
		// notifications respects the user's Notifications setting.
		const isComment = n.type === 'comment-reply' || n.type === 'comment-reaction';
		if (isComment && !shouldNotifyComments()) return;
		// Shared-session invites get their own richer flydown (with an Accept
		// action) from shared-session.service — skip the generic toast here so
		// the invite isn't double-toasted. It still lands in the bell panel above.
		if (n.type === 'shared-session-invite') return;
		const f = formatNotification(n);
		notifyInfo(`${f.icon ? `${f.icon} ` : ''}${f.message}`, 6000);
	});
}

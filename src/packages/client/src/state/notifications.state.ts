import { signal } from '@preact/signals';

// ============================================
// Types
// ============================================

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/**
 * Optional clickable action inside a toast. Use a `href` for in-app
 * navigation links (e.g. an admin job detail page) — the Toast
 * component handles routing via preact-router. `onClick` is for
 * non-navigational handlers; if both are provided, onClick fires
 * first and may preventDefault by returning false.
 */
export interface NotificationAction {
	label: string;
	href?: string;
	/**
	 * Return `true` to keep the toast open after the action runs;
	 * any other return (including `undefined`) closes it.
	 */
	onClick?: () => boolean | undefined;
}

export interface Notification {
	id: string;
	type: NotificationType;
	message: string;
	duration: number;
	actions?: NotificationAction[];
}

// ============================================
// Signals
// ============================================

export const notifications = signal<Notification[]>([]);

// ============================================
// Actions
// ============================================

let idCounter = 0;

export function addNotification(
	type: NotificationType,
	message: string,
	duration = 5000,
	actions?: NotificationAction[],
): string {
	const id = `notification-${++idCounter}-${Date.now()}`;

	const notification: Notification = { id, type, message, duration, actions };

	notifications.value = [...notifications.value, notification];

	if (duration > 0) {
		setTimeout(() => {
			removeNotification(id);
		}, duration);
	}

	return id;
}

export function removeNotification(id: string): void {
	notifications.value = notifications.value.filter((n) => n.id !== id);
}

export function clearNotifications(): void {
	notifications.value = [];
}

// Convenience helpers — each takes an optional `actions` array of
// clickable links (e.g. "Job 5e4b…" pointing at the job details page)
// rendered inline alongside the message.
export function notifySuccess(
	message: string,
	duration?: number,
	actions?: NotificationAction[],
): string {
	return addNotification('success', message, duration, actions);
}

export function notifyError(
	message: string,
	duration?: number,
	actions?: NotificationAction[],
): string {
	return addNotification('error', message, duration ?? 8000, actions);
}

export function notifyWarning(
	message: string,
	duration?: number,
	actions?: NotificationAction[],
): string {
	return addNotification('warning', message, duration, actions);
}

export function notifyInfo(
	message: string,
	duration?: number,
	actions?: NotificationAction[],
): string {
	return addNotification('info', message, duration, actions);
}

// ============================================
// Per-feature gates (read from localStorage; written from Settings page)
// ============================================

/** Whether playlist-membership change toasts are enabled. Default on. */
export function shouldNotifyComments(): boolean {
	return localStorage.getItem('mu_notify_comments') !== 'false';
}

export function shouldNotifyPlaylist(): boolean {
	return localStorage.getItem('mu_notify_playlist') !== 'false';
}

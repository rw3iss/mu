import { signal } from '@preact/signals';

// ============================================
// Types
// ============================================

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration: number;
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
  duration = 5000
): string {
  const id = `notification-${++idCounter}-${Date.now()}`;

  const notification: Notification = { id, type, message, duration };

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

// Convenience helpers
export function notifySuccess(message: string, duration?: number): string {
  return addNotification('success', message, duration);
}

export function notifyError(message: string, duration?: number): string {
  return addNotification('error', message, duration ?? 8000);
}

export function notifyWarning(message: string, duration?: number): string {
  return addNotification('warning', message, duration);
}

export function notifyInfo(message: string, duration?: number): string {
  return addNotification('info', message, duration);
}

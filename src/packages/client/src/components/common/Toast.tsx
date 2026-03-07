import { h } from 'preact';
import { notifications, removeNotification } from '@/state/notifications.state';
import type { NotificationType } from '@/state/notifications.state';
import styles from './Toast.module.scss';

const typeIcons: Record<NotificationType, string> = {
  success: '\u2713',
  error: '\u2717',
  warning: '\u26A0',
  info: '\u2139',
};

export function Toast() {
  const items = notifications.value;

  if (items.length === 0) return null;

  return (
    <div class={styles.container} aria-live="polite">
      {items.map((notification) => (
        <div
          key={notification.id}
          class={`${styles.toast} ${styles[notification.type]}`}
          role="alert"
        >
          <span class={styles.icon}>{typeIcons[notification.type]}</span>
          <span class={styles.message}>{notification.message}</span>
          <button
            class={styles.close}
            onClick={() => removeNotification(notification.id)}
            aria-label="Dismiss notification"
          >
            {'\u2715'}
          </button>
        </div>
      ))}
    </div>
  );
}

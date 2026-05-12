import { Icon, type IconName } from '@/components/common/Icon';
import type { NotificationType } from '@/state/notifications.state';
import { notifications, removeNotification } from '@/state/notifications.state';
import styles from './Toast.module.scss';

const typeIcons: Record<NotificationType, IconName> = {
	success: 'check-circle',
	error: 'x-circle',
	warning: 'warning',
	info: 'info',
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
					<span class={styles.icon}>
						<Icon name={typeIcons[notification.type]} />
					</span>
					<span class={styles.message}>{notification.message}</span>
					<button
						class={styles.close}
						onClick={() => removeNotification(notification.id)}
						aria-label="Dismiss notification"
					>
						<Icon name="x" size={14} />
					</button>
				</div>
			))}
		</div>
	);
}

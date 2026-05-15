import { route } from 'preact-router';
import { Icon, type IconName } from '@/components/common/Icon';
import type { NotificationAction, NotificationType } from '@/state/notifications.state';
import { notifications, removeNotification } from '@/state/notifications.state';
import styles from './Toast.module.scss';

const typeIcons: Record<NotificationType, IconName> = {
	success: 'check-circle',
	error: 'x-circle',
	warning: 'warning',
	info: 'info',
};

function handleActionClick(e: MouseEvent, action: NotificationAction): void {
	const stopNav = action.onClick?.() === false;
	if (action.href && !stopNav) {
		e.preventDefault();
		route(action.href);
	}
}

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
					<div class={styles.body}>
						<span class={styles.message}>{notification.message}</span>
						{notification.actions && notification.actions.length > 0 && (
							<span class={styles.actions}>
								{notification.actions.map((a, i) => (
									<a
										key={i}
										class={styles.actionLink}
										href={a.href ?? '#'}
										onClick={(e) => handleActionClick(e, a)}
									>
										{a.label}
									</a>
								))}
							</span>
						)}
					</div>
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

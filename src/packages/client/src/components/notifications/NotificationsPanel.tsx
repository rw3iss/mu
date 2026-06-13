import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import {
	loadMoreNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	notifications,
	notificationsHasMore,
	notificationsLoading,
	removeNotification,
} from '@/state/notifications-feed.state';
import { formatNotification } from '@/utils/notification-format';
import { relativeTime } from '@/utils/time-format';
import styles from './NotificationsPanel.module.scss';

/** Dropdown list of the current user's notifications (personal + system). */
export function NotificationsPanel({ onClose }: { onClose: () => void }) {
	const list = notifications.value;

	const handleClick = (id: string, href: string | null) => {
		markNotificationRead(id);
		if (href) {
			route(href);
			onClose();
		}
	};

	return (
		<div class={styles.panel} role="menu">
			<div class={styles.header}>
				<span class={styles.title}>Notifications</span>
				{list.some((n) => !n.read) && (
					<button class={styles.markAll} onClick={() => markAllNotificationsRead()}>
						Mark all read
					</button>
				)}
			</div>

			<div class={styles.list}>
				{list.length === 0 ? (
					<div class={styles.empty}>
						{notificationsLoading.value ? 'Loading…' : 'No notifications yet.'}
					</div>
				) : (
					list.map((n) => {
						const f = formatNotification(n);
						return (
							<div key={n.id} class={`${styles.item} ${n.read ? '' : styles.unread}`}>
								<button
									class={styles.itemBody}
									onClick={() => handleClick(n.id, f.href)}
								>
									{f.icon && <span class={styles.itemIcon}>{f.icon}</span>}
									<div class={styles.itemText}>
										<span class={styles.itemMessage}>{f.message}</span>
										<span class={styles.itemTime}>
											{relativeTime(n.createdAt)}
										</span>
									</div>
								</button>
								<button
									class={styles.dismiss}
									onClick={() => removeNotification(n.id)}
									aria-label="Dismiss"
									title="Dismiss"
								>
									<Icon name="x" size={12} />
								</button>
							</div>
						);
					})
				)}
				{notificationsHasMore.value && (
					<button
						class={styles.loadMore}
						disabled={notificationsLoading.value}
						onClick={() => loadMoreNotifications()}
					>
						{notificationsLoading.value ? 'Loading…' : 'Load more'}
					</button>
				)}
			</div>
		</div>
	);
}

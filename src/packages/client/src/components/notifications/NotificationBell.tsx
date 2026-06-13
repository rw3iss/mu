import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { notificationsUnread } from '@/state/notifications-feed.state';
import styles from './NotificationBell.module.scss';
import { NotificationsPanel } from './NotificationsPanel';

/** Header bell with unread badge; toggles the notifications dropdown. */
export function NotificationBell() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const unread = notificationsUnread.value;

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		const id = setTimeout(() => {
			document.addEventListener('mousedown', onDown);
			document.addEventListener('keydown', onKey);
		}, 0);
		return () => {
			clearTimeout(id);
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	return (
		<div class={styles.wrap} ref={ref}>
			<button
				class={styles.bell}
				onClick={() => setOpen((v) => !v)}
				aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
				title="Notifications"
			>
				<Icon name="bell" />
				{unread > 0 && <span class={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
			</button>
			{open && <NotificationsPanel onClose={() => setOpen(false)} />}
		</div>
	);
}

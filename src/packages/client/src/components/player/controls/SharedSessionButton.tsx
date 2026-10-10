import {
	activeSession,
	chatUnread,
	showSessionMenu,
	toggleSessionMenu,
} from '@/state/shared-session.state';
import styles from '../PlayerControls.module.scss';
import { PeopleIcon } from '../session/SessionIcons';
import { SessionMenu } from '../session/SessionMenu';

/**
 * Shared Session — visible only when in a session. Sits left of Info; shows
 * a chat-unread badge and opens the session menu.
 */
export function SharedSessionButton() {
	if (!activeSession.value) return null;
	return (
		<div class={styles.menuContainer} data-session-menu-anchor>
			<button
				class={`${styles.controlBtn} ${showSessionMenu.value ? styles.active : ''}`}
				onClick={toggleSessionMenu}
				aria-label="Shared session"
				title="Shared Session"
			>
				<PeopleIcon size={20} />
				{chatUnread.value > 0 && (
					<span class={styles.sessionBadge}>
						{chatUnread.value > 9 ? '9+' : chatUnread.value}
					</span>
				)}
			</button>
			{showSessionMenu.value && <SessionMenu />}
		</div>
	);
}

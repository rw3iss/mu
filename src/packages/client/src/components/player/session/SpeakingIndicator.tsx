import { createPortal } from 'preact/compat';
import { currentUser } from '@/state/auth.state';
import {
	activeSession,
	sessionMembers,
	sessionSettings,
	speakingUsers,
} from '@/state/shared-session.state';
import { MicIcon } from './SessionIcons';
import styles from './SpeakingIndicator.module.scss';

/**
 * Small bottom-center popup listing who is currently talking (including you).
 * Only shown while in a session with voice + the speaking-indicator setting on.
 */
export function SpeakingIndicator() {
	if (!activeSession.value) return null;
	const s = sessionSettings.value;
	if (!s.showSpeakingIndicator || !s.enableVoice) return null;

	const ids = speakingUsers.value;
	if (ids.length === 0) return null;

	const me = currentUser.value;
	const nameFor = (id: string): string => {
		if (id === me?.id) return 'You';
		const m = sessionMembers.value.find((x) => x.userId === id);
		return m?.name ?? 'Someone';
	};

	const names = ids.map(nameFor);
	const label =
		names.length === 1
			? `${names[0]} is talking`
			: names.length === 2
				? `${names[0]} and ${names[1]} are talking`
				: `${names[0]}, ${names[1]} +${names.length - 2} talking`;

	return createPortal(
		<div class={styles.wrap} role="status" aria-live="polite">
			<span class={styles.icon}>
				<MicIcon size={14} />
			</span>
			<span class={styles.label}>{label}</span>
		</div>,
		document.body,
	);
}

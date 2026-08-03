import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { sharedSessionService } from '@/services/shared-session.service';
import { notifyError } from '@/state/notifications.state';
import { pendingInvite } from '@/state/shared-session.state';
import styles from './AcceptInviteModal.module.scss';

/**
 * Richer confirm for an incoming invite (Zoom-style). Shows when
 * `pendingInvite` is set — the core service also fires a flydown toast whose
 * Accept action joins directly; this modal offers the mic-on toggle.
 */
export function AcceptInviteModal() {
	const invite = pendingInvite.value;
	const [micOn, setMicOn] = useState(true);
	const [joining, setJoining] = useState(false);

	// Reset the mic toggle whenever a fresh invite arrives.
	useEffect(() => {
		if (invite) setMicOn(true);
	}, [invite?.sessionId]);

	if (!invite) return null;

	const join = async () => {
		setJoining(true);
		try {
			await sharedSessionService.joinSession(invite.sessionId, { micOn });
		} catch {
			notifyError('Could not join the session — it may have ended.');
			pendingInvite.value = null;
		} finally {
			setJoining(false);
		}
	};

	const decline = () => {
		pendingInvite.value = null;
	};

	return (
		<Modal isOpen={!!invite} onClose={decline} title="Shared Session Invite" size="sm">
			<div class={styles.wrap}>
				<p class={styles.lead}>
					<strong>{invite.hostName}</strong> invited you to watch{' '}
					<strong>{invite.movieTitle ?? 'a movie'}</strong> together.
				</p>

				<button
					type="button"
					class={styles.toggleRow}
					onClick={() => setMicOn((v) => !v)}
					aria-pressed={micOn}
				>
					<span class={styles.toggleLabel}>Join with mic on</span>
					<span class={`${styles.toggle} ${micOn ? styles.on : ''}`} aria-hidden="true" />
				</button>

				<div class={styles.actions}>
					<Button variant="secondary" onClick={decline} disabled={joining}>
						Decline
					</Button>
					<Button variant="primary" onClick={join} loading={joining}>
						Join
					</Button>
				</div>
			</div>
		</Modal>
	);
}

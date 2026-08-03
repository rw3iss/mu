import { useMemo, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { sharedSessionService } from '@/services/shared-session.service';
import { currentUser } from '@/state/auth.state';
import { notifyError } from '@/state/notifications.state';
import { isSessionAdmin, sessionMembers } from '@/state/shared-session.state';
import styles from './AcceptInviteModal.module.scss';
import { closeLeaveModal, showLeaveModal } from './session-ui.state';

/**
 * Confirm leaving the session. If the leaver is the admin, they must nominate
 * a new admin from the remaining joined members (unless they're the last one,
 * in which case leaving ends the session server-side).
 */
export function LeaveSessionModal() {
	const open = showLeaveModal.value;
	const admin = isSessionAdmin.value;
	const meId = currentUser.value?.id;
	const [newAdminId, setNewAdminId] = useState('');
	const [leaving, setLeaving] = useState(false);

	const candidates = useMemo(
		() => sessionMembers.value.filter((m) => m.userId !== meId && m.state === 'joined'),
		[sessionMembers.value, meId],
	);

	const needsTransfer = admin && candidates.length > 0;

	const leave = async () => {
		if (needsTransfer && !newAdminId) return;
		setLeaving(true);
		try {
			await sharedSessionService.leaveSession(needsTransfer ? newAdminId : undefined);
			closeLeaveModal();
		} catch {
			notifyError('Failed to leave the session.');
		} finally {
			setLeaving(false);
		}
	};

	return (
		<Modal isOpen={open} onClose={closeLeaveModal} title="Leave Shared Session" size="sm">
			<div class={styles.wrap}>
				<p class={styles.lead}>
					{needsTransfer
						? 'You are the session admin. Pick who should take over before you leave.'
						: 'Leave this shared session? Your movie keeps playing on its own.'}
				</p>

				{needsTransfer && (
					<select
						class={styles.select}
						value={newAdminId}
						onChange={(e) => setNewAdminId((e.target as HTMLSelectElement).value)}
					>
						<option value="">Select new admin…</option>
						{candidates.map((m) => (
							<option key={m.userId} value={m.userId}>
								{m.name}
							</option>
						))}
					</select>
				)}

				<div class={styles.actions}>
					<Button variant="secondary" onClick={closeLeaveModal} disabled={leaving}>
						Cancel
					</Button>
					<Button
						variant="danger"
						onClick={leave}
						disabled={needsTransfer && !newAdminId}
						loading={leaving}
					>
						Leave
					</Button>
				</div>
			</div>
		</Modal>
	);
}

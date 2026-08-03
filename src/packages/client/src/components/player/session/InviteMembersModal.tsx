import type { InvitableMember } from '@mu/shared';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Avatar } from '@/components/common/Avatar';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { sharedSessionService } from '@/services/shared-session.service';
import { notifyError } from '@/state/notifications.state';
import { sessionMembers } from '@/state/shared-session.state';
import styles from './InviteMembersModal.module.scss';
import { closeInviteModal, showInviteModal } from './session-ui.state';

/**
 * Multi-select member picker for inviting people to the active session.
 * Whole-row click toggles the checkbox. Members already in the session are
 * excluded from the list.
 */
export function InviteMembersModal() {
	const open = showInviteModal.value;
	const [members, setMembers] = useState<InvitableMember[]>([]);
	const [loading, setLoading] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [sending, setSending] = useState(false);

	// Ids already in the session (joined/invited) — excluded from the picker.
	const existingIds = useMemo(
		() => new Set(sessionMembers.value.map((m) => m.userId)),
		[sessionMembers.value],
	);

	useEffect(() => {
		if (!open) return;
		setSelected(new Set());
		setLoading(true);
		sharedSessionService
			.listInvitableMembers()
			.then((list) => setMembers(list))
			.catch(() => notifyError('Failed to load members.'))
			.finally(() => setLoading(false));
	}, [open]);

	const visible = members.filter((m) => !existingIds.has(m.id));

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const send = async () => {
		if (selected.size === 0) return;
		setSending(true);
		try {
			await sharedSessionService.inviteMembers([...selected]);
			closeInviteModal();
		} catch {
			notifyError('Failed to send invites.');
		} finally {
			setSending(false);
		}
	};

	return (
		<Modal isOpen={open} onClose={closeInviteModal} title="Invite to Session" size="sm">
			<div class={styles.wrap}>
				{loading ? (
					<div class={styles.empty}>
						<Spinner size="sm" />
					</div>
				) : visible.length === 0 ? (
					<div class={styles.empty}>No one else to invite.</div>
				) : (
					<ul class={styles.list}>
						{visible.map((m) => {
							const checked = selected.has(m.id);
							return (
								<li key={m.id}>
									<button
										type="button"
										class={`${styles.row} ${checked ? styles.rowChecked : ''}`}
										onClick={() => toggle(m.id)}
										aria-pressed={checked}
									>
										<span
											class={`${styles.checkbox} ${checked ? styles.checkboxOn : ''}`}
											aria-hidden="true"
										>
											{checked && (
												<svg
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="3"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<polyline points="20 6 9 17 4 12" />
												</svg>
											)}
										</span>
										<Avatar name={m.name} src={m.avatarUrl} size={32} />
										<span class={styles.name}>{m.name}</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}

				<div class={styles.actions}>
					<Button variant="secondary" onClick={closeInviteModal} disabled={sending}>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={send}
						disabled={selected.size === 0}
						loading={sending}
					>
						Send invites
						{selected.size > 0 ? ` (${selected.size})` : ''}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

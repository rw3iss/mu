import { useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { sharedSessionService } from '@/services/shared-session.service';
import {
	allVoicesMuted,
	closeSessionMenu,
	isSessionAdmin,
	sessionSettings,
	toggleChatWindow,
	toggleSessionSettingsPanel,
	toggleVoicePanel,
	voiceMuted,
} from '@/state/shared-session.state';
import { ChatIcon, LogOutIcon, MicIcon, UserPlusIcon } from './SessionIcons';
import styles from './SessionMenu.module.scss';
import { openEndModal, openInviteModal, openLeaveModal } from './session-ui.state';

/**
 * Dropdown menu for the in-session toolbar button. Self-gates on
 * `showSessionMenu`; anchored by the caller (PlayerControls) inside a
 * relatively-positioned container.
 */
export function SessionMenu() {
	const [voiceOpen, setVoiceOpen] = useState(false);
	const admin = isSessionAdmin.value;
	const s = sessionSettings.value;
	const canInvite = admin || s.allowMemberInvites;

	const close = () => {
		setVoiceOpen(false);
		closeSessionMenu();
	};

	return (
		<div class={styles.menu} data-session-menu onClick={(e: Event) => e.stopPropagation()}>
			{canInvite && (
				<button
					class={styles.item}
					onClick={() => {
						close();
						openInviteModal();
					}}
				>
					<span class={styles.itemIcon}>
						<UserPlusIcon size={15} />
					</span>
					<span class={styles.itemLabel}>Invite to Session</span>
				</button>
			)}

			{s.enableChat && (
				<button
					class={styles.item}
					onClick={() => {
						close();
						toggleChatWindow();
					}}
				>
					<span class={styles.itemIcon}>
						<ChatIcon size={15} />
					</span>
					<span class={styles.itemLabel}>Chat</span>
				</button>
			)}

			{s.enableVoice && (
				<div class={styles.subGroup}>
					<button
						class={styles.item}
						onClick={() => setVoiceOpen((v) => !v)}
						aria-expanded={voiceOpen}
					>
						<span class={styles.itemIcon}>
							<MicIcon size={15} />
						</span>
						<span class={styles.itemLabel}>Voice Audio</span>
						<span class={styles.itemChevron}>
							<Icon name={voiceOpen ? 'chevron-down' : 'chevron-right'} size={14} />
						</span>
					</button>
					{voiceOpen && (
						<div class={styles.subMenu}>
							<button
								class={styles.subItem}
								onClick={() => {
									close();
									toggleVoicePanel();
								}}
							>
								Configure…
							</button>
							<button
								class={styles.subItem}
								onClick={() => sharedSessionService.setMicMuted(!voiceMuted.value)}
							>
								{voiceMuted.value ? 'Unmute My Voice' : 'Mute My Voice'}
							</button>
							<button
								class={styles.subItem}
								onClick={() =>
									sharedSessionService.setAllVoicesMuted(!allVoicesMuted.value)
								}
							>
								{allVoicesMuted.value ? 'Unmute All Voices' : 'Mute All Voices'}
							</button>
						</div>
					)}
				</div>
			)}

			{admin && (
				<button
					class={styles.item}
					onClick={() => {
						close();
						toggleSessionSettingsPanel();
					}}
				>
					<span class={styles.itemIcon}>
						<Icon name="settings" size={15} />
					</span>
					<span class={styles.itemLabel}>Settings</span>
				</button>
			)}

			<div class={styles.divider} />

			<button
				class={`${styles.item} ${styles.danger}`}
				onClick={() => {
					close();
					openLeaveModal();
				}}
			>
				<span class={styles.itemIcon}>
					<LogOutIcon size={15} />
				</span>
				<span class={styles.itemLabel}>Leave Shared Session</span>
			</button>

			{admin && (
				<button
					class={`${styles.item} ${styles.danger}`}
					onClick={() => {
						close();
						openEndModal();
					}}
				>
					<span class={styles.itemIcon}>
						<Icon name="x-circle" size={15} />
					</span>
					<span class={styles.itemLabel}>End Shared Session</span>
				</button>
			)}
		</div>
	);
}

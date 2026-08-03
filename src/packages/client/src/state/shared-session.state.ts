import {
	type ChatMessage,
	DEFAULT_SHARED_SESSION_SETTINGS,
	type SharedSessionInviteData,
	type SharedSessionPresence,
	type SharedSessionSettings,
	type SharedSessionView,
} from '@mu/shared';
import { batch, computed, signal } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { currentUser } from '@/state/auth.state';

/**
 * Client state for the Shared Sessions (watch party) feature.
 *
 * Everything here is gated on {@link activeSession}: when it's null the app
 * behaves exactly as it always has (no playback interception, no voice/chat).
 * The service layer (`shared-session.service.ts`) mutates these signals in
 * response to REST calls + WebSocket events; UI components read them.
 */

// ── Core session ──

/** The current watch-party the user is in, or null. */
export const activeSession = signal<SharedSessionView | null>(null);

/** The active session's settings (defaults when there's no session). */
export const sessionSettings = computed<SharedSessionSettings>(
	() => activeSession.value?.settings ?? DEFAULT_SHARED_SESSION_SETTINGS,
);

/** True when the current user is the session admin. */
export const isSessionAdmin = computed(
	() => !!activeSession.value && activeSession.value.adminUserId === currentUser.value?.id,
);

/** Whether the current user may play/pause (always true with no session). */
export const canControlPlayback = computed(
	() => !activeSession.value || isSessionAdmin.value || sessionSettings.value.allowMembersControl,
);

/** Whether the current user may seek/scrub (always true with no session). */
export const canSeekPlayback = computed(
	() => !activeSession.value || isSessionAdmin.value || sessionSettings.value.allowSeeking,
);

/** The session roster. */
export const sessionMembers = computed(() => activeSession.value?.members ?? []);

// ── Chat ──

export const chatMessages = signal<ChatMessage[]>([]);
export const chatUnread = signal<number>(0);

// ── Voice ──

/** Local mic muted (this user's outgoing voice). */
export const voiceMuted = signal<boolean>(false);
/** All incoming peer voices muted locally (hear only the movie). */
export const allVoicesMuted = signal<boolean>(false);
/** Per-peer live voice/ready presence, keyed by userId. */
export const peerPresence = signal<Record<string, SharedSessionPresence>>({});
/** User ids currently talking (voice-activity above threshold). */
export const speakingUsers = computed(() =>
	Object.values(peerPresence.value)
		.filter((p) => p.speaking)
		.map((p) => p.userId),
);

// ── Invite ──

/** A received-but-not-yet-accepted invite (drives the accept modal). */
export const pendingInvite = signal<SharedSessionInviteData | null>(null);

// ── Per-user client setting: duck the movie while a peer talks ──

const DUCK_KEY = 'mu_voice_duck';
export const duckMovieEnabled = signal<boolean>(getUiSetting(DUCK_KEY, false));
export function setDuckMovieEnabled(enabled: boolean): void {
	duckMovieEnabled.value = enabled;
	setUiSetting(DUCK_KEY, enabled);
}

// ── Panels / menus ──

export const showSessionMenu = signal(false);
export const showSessionSettingsPanel = signal(false);
export const showVoicePanel = signal(false);
export const showChatWindow = signal(false);

export function toggleSessionMenu(): void {
	showSessionMenu.value = !showSessionMenu.value;
}
export function closeSessionMenu(): void {
	showSessionMenu.value = false;
}

export function toggleSessionSettingsPanel(): void {
	showSessionSettingsPanel.value = !showSessionSettingsPanel.value;
}
export function closeSessionSettingsPanel(): void {
	showSessionSettingsPanel.value = false;
}

export function toggleVoicePanel(): void {
	showVoicePanel.value = !showVoicePanel.value;
}
export function closeVoicePanel(): void {
	showVoicePanel.value = false;
}

export function toggleChatWindow(): void {
	const next = !showChatWindow.value;
	showChatWindow.value = next;
	// Opening the chat clears the unread badge.
	if (next) chatUnread.value = 0;
}
export function closeChatWindow(): void {
	showChatWindow.value = false;
}

// ── Reset ──

/** Tear down all session-related client state (leave / end / logout). */
export function clearSessionState(): void {
	batch(() => {
		activeSession.value = null;
		chatMessages.value = [];
		chatUnread.value = 0;
		voiceMuted.value = false;
		allVoicesMuted.value = false;
		peerPresence.value = {};
		pendingInvite.value = null;
		showSessionMenu.value = false;
		showSessionSettingsPanel.value = false;
		showVoicePanel.value = false;
		showChatWindow.value = false;
	});
}

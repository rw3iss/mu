import {
	type ChatMessage,
	DEFAULT_SHARED_SESSION_SETTINGS,
	type IceConfig,
	type InvitableMember,
	type NotificationDto,
	NotificationType,
	type SessionCommand,
	type SharedSessionInviteData,
	type SharedSessionMemberView,
	type SharedSessionPresence,
	type SharedSessionSettings,
	type SharedSessionView,
	type SignalMessage,
	WsEvent,
} from '@mu/shared';
import { micAudioEngine } from '@/audio/mic-audio-engine';
import { api } from '@/services/api';
import {
	applyRemoteCommand,
	isApplyingRemote,
	startHeartbeat,
	stopHeartbeat,
} from '@/services/session-sync';
import { voiceMesh } from '@/services/voice-mesh';
import { wsService } from '@/services/websocket.service';
import { currentUser } from '@/state/auth.state';
import {
	forceStartPosition,
	globalMovieId,
	playMovie,
	sharedSessionHooks,
} from '@/state/globalPlayer.state';
import { notifyError, notifyInfo } from '@/state/notifications.state';
import { currentTime, isPlaying } from '@/state/player.state';
import {
	activeSession,
	allVoicesMuted,
	canControlPlayback,
	chatMessages,
	chatUnread,
	clearSessionState,
	peerPresence,
	pendingInvite,
	sessionSettings,
	showChatWindow,
	voiceMuted,
} from '@/state/shared-session.state';
import { initVoiceEffects } from '@/state/voice-effects.state';

/** Command envelope carried over the session channel (SessionCommand + routing). */

/** Presence/roster envelope. */
interface PresenceEnvelope {
	sessionId: string;
	userId?: string;
	/** Ad-hoc handshake: a fresh joiner asking the controller for an immediate heartbeat. */
	request?: 'sync';
	members?: SharedSessionMemberView[];
	presence?: SharedSessionPresence[];
	view?: SharedSessionView;
}

/** Join/left envelope. */
interface RosterEnvelope {
	sessionId: string;
	member?: SharedSessionMemberView;
	view?: SharedSessionView;
}

/**
 * Client orchestrator for Shared Sessions. Owns the REST wrappers, all WebSocket
 * wiring, the sync-engine hookup, the voice mesh, and the mic engine lifecycle.
 * The UI layer calls these methods from buttons/menus and reads the signals in
 * `shared-session.state.ts` / `voice-effects.state.ts`.
 */
class SharedSessionService {
	private wired = false;

	// ── Bootstrap ──

	/** Wire all inbound WS handlers. Call once at app start. */
	initSharedSessions(): void {
		if (this.wired) return;
		this.wired = true;

		wsService.on(WsEvent.SHARED_SESSION_COMMAND, (d) =>
			this.onCommand(d as { sessionId: string; command: SessionCommand }),
		);
		wsService.on(WsEvent.SHARED_SESSION_CHAT, (d) =>
			this.onChat(d as { sessionId: string; message: ChatMessage }),
		);
		wsService.on(WsEvent.SHARED_SESSION_SIGNAL, (d) => this.onSignal(d as SignalMessage));
		wsService.on(WsEvent.SHARED_SESSION_PRESENCE, (d) =>
			this.onPresence(d as PresenceEnvelope),
		);
		wsService.on(WsEvent.SHARED_SESSION_SETTINGS, (d) =>
			this.onSettings(d as { sessionId: string; settings: SharedSessionSettings }),
		);
		wsService.on(WsEvent.SHARED_SESSION_ADMIN, (d) =>
			this.onAdmin(d as { sessionId: string; adminUserId: string }),
		);
		wsService.on(WsEvent.SHARED_SESSION_JOINED, (d) => this.onJoined(d as RosterEnvelope));
		wsService.on(WsEvent.SHARED_SESSION_LEFT, (d) => this.onLeft(d as RosterEnvelope));
		wsService.on(WsEvent.SHARED_SESSION_ENDED, (d) => this.onEnded(d as { sessionId: string }));

		// Invites arrive on the generic notification channel.
		wsService.on(WsEvent.NOTIFICATION, (d) => this.onNotification(d as NotificationDto));

		// Let the player evict us from a party when the user closes it or plays a
		// different movie (callback, not an import — that would be circular).
		sharedSessionHooks.leaveActiveSession = (keepForMovieId?: string) => {
			const view = activeSession.value;
			if (!view) return;
			// Loading the party's OWN movie is how joining works — not a departure.
			if (keepForMovieId && view.movieId === keepForMovieId) return;
			void this.leaveSession().catch(() => {
				// Best-effort: never block closing the player / starting a movie.
			});
		};
	}

	/** Rehydrate on app load: if the user has an active session, rejoin it. */
	async hydrate(): Promise<void> {
		try {
			const view = await api.get<SharedSessionView | null>('/shared-sessions/mine');
			if (!view || view.status !== 'active' || !view.myRole) return;
			// Don't let a lingering session commandeer normal solo playback: if the
			// player has already restored a DIFFERENT movie (initGlobalPlayer runs
			// before this), the user has moved on — skip the auto-rejoin so we don't
			// force-load the session's movie (and subject their playback to the
			// party's play/pause/seek commands) on every refresh. They can rejoin
			// manually from the session menu. Rejoin only when the player is empty
			// or already on the session's movie.
			if (globalMovieId.value && globalMovieId.value !== view.movieId) return;
			await this.enterSession(view, { micOn: true, loadMovie: true, requestSync: true });
		} catch {
			/* no active session / not reachable — ignore */
		}
	}

	// ── REST lifecycle ──

	/** Create a session for the currently-playing movie; caller becomes admin. */
	async startSession(movieId: string, name?: string): Promise<SharedSessionView> {
		const view = await api.post<SharedSessionView>('/shared-sessions', { movieId, name });
		// The movie is already loaded in the player (start-from-player flow), so
		// don't reload it. As creator we're the initial controller.
		await this.enterSession(view, { micOn: true, loadMovie: false, requestSync: false });
		this.becomeController();
		return view;
	}

	/** Invite members by user id (admin, or members when allowed). */
	async inviteMembers(userIds: string[]): Promise<void> {
		const s = activeSession.value;
		if (!s) return;
		await api.post(`/shared-sessions/${s.id}/invite`, { userIds });
		notifyInfo(
			`Invited ${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}.`,
			3000,
		);
	}

	/** The roster the invite picker draws from (ignores Show-Users-Info switch). */
	listInvitableMembers(): Promise<InvitableMember[]> {
		return api.get<{ members: InvitableMember[] }>('/members/invitable').then((r) => r.members);
	}

	/** Accept an invite / open a session by id. */
	async joinSession(sessionId: string, opts: { micOn: boolean }): Promise<SharedSessionView> {
		const view = await api.post<SharedSessionView>(`/shared-sessions/${sessionId}/join`, {});
		pendingInvite.value = null;
		await this.enterSession(view, {
			micOn: opts.micOn,
			loadMovie: true,
			requestSync: true,
		});
		return view;
	}

	/** Leave the session. If admin, `newAdminUserId` transfers before leaving. */
	async leaveSession(newAdminUserId?: string): Promise<void> {
		const s = activeSession.value;
		if (!s) return;
		try {
			await api.post(`/shared-sessions/${s.id}/leave`, { newAdminUserId });
		} finally {
			this.teardownLocal();
		}
	}

	/** Transfer admin to another member (admin only). */
	async transferAdmin(userId: string): Promise<void> {
		const s = activeSession.value;
		if (!s) return;
		await api.post(`/shared-sessions/${s.id}/transfer-admin`, { userId });
	}

	/** End the session for everyone (admin only). */
	async endSession(): Promise<void> {
		const s = activeSession.value;
		if (!s) return;
		try {
			await api.post(`/shared-sessions/${s.id}/end`, {});
		} finally {
			this.teardownLocal();
		}
	}

	/** Patch session settings (admin only); server broadcasts the change. */
	async updateSettings(patch: Partial<SharedSessionSettings>): Promise<void> {
		const s = activeSession.value;
		if (!s) return;
		const settings: SharedSessionSettings = { ...s.settings, ...patch };
		// Optimistic local apply; the SETTINGS broadcast confirms for everyone.
		activeSession.value = { ...s, settings };
		await api.patch(`/shared-sessions/${s.id}/settings`, { settings }).catch((err) => {
			notifyError('Failed to update session settings.');
			throw err;
		});
	}

	// ── Chat ──

	/** Send a chat message; the server persists + relays it back to everyone. */
	sendChat(text: string): void {
		const s = activeSession.value;
		const trimmed = text.trim();
		if (!s || !trimmed || !sessionSettings.value.enableChat) return;
		wsService.send(WsEvent.SHARED_SESSION_CHAT, { sessionId: s.id, text: trimmed });
	}

	/** Backfill persisted chat history (call when opening the chat window). */
	async loadChatHistory(): Promise<void> {
		const s = activeSession.value;
		if (!s) return;
		try {
			const msgs = await api.get<ChatMessage[]>(`/shared-sessions/${s.id}/messages`);
			chatMessages.value = msgs;
		} catch {
			/* non-critical */
		}
	}

	// ── Playback sync ──

	/**
	 * Broadcast a local playback action. Guarded: only fires with an active
	 * session AND control permission, and never while applying a remote command
	 * (echo guard). Emitting a play/pause/seek makes this client the controller.
	 */
	broadcastLocalCommand(
		kind: 'play' | 'pause' | 'seek' | 'heartbeat',
		positionSeconds: number,
	): void {
		const s = activeSession.value;
		const me = currentUser.value;
		if (!s || !me || !canControlPlayback.value) return;
		if (kind !== 'heartbeat' && isApplyingRemote()) return;

		const playing = kind === 'play' ? true : kind === 'pause' ? false : isPlaying.value;

		// Server envelope: { sessionId, command: SessionCommand } (it overwrites
		// command.byUserId with the authenticated socket id before relaying).
		wsService.send(WsEvent.SHARED_SESSION_COMMAND, {
			sessionId: s.id,
			command: {
				kind,
				positionSeconds,
				playing,
				at: Date.now(),
				byUserId: me.id,
				byName: me.displayName || me.username,
			},
		});

		// A real action (not a heartbeat) makes us the last actor → controller.
		if (kind !== 'heartbeat') this.becomeController();
	}

	// ── Voice controls ──

	/** Mute/unmute the outgoing mic. */
	setMicMuted(muted: boolean): void {
		voiceMuted.value = muted;
		micAudioEngine.setTrackEnabled(!muted);
		this.publishPresence({ muted });
	}

	/** Mute/unmute all incoming peer voices (hear only the movie). */
	setAllVoicesMuted(muted: boolean): void {
		allVoicesMuted.value = muted;
		voiceMesh.setAllMuted(muted);
	}

	/** Change the mic capture device (rebuilds the processed track on all peers). */
	async setInputDevice(deviceId: string): Promise<void> {
		await micAudioEngine.setInputDevice(deviceId);
		voiceMesh.replaceLocalTrack(micAudioEngine.getProcessedTrack());
	}

	listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
		return micAudioEngine.listInputDevices();
	}

	/** ICE (STUN/TURN) config for the WebRTC mesh. */
	getIceConfig(): Promise<IceConfig> {
		return api.get<IceConfig>('/shared-sessions/ice-config');
	}

	// ── Internal ──

	private async enterSession(
		view: SharedSessionView,
		opts: { micOn: boolean; loadMovie: boolean; requestSync: boolean },
	): Promise<void> {
		activeSession.value = view;
		chatMessages.value = [];
		chatUnread.value = 0;
		peerPresence.value = {};

		wsService.subscribe(`session:${view.id}`);

		if (opts.loadMovie && globalMovieId.value !== view.movieId) {
			// Start at 0; the controller heartbeat (≤3s, or an immediate one via
			// the sync request below) pulls us to the live position.
			forceStartPosition.value = 0;
			await playMovie(view.movieId);
		}

		if (sessionSettings.value.enableVoice) {
			await this.connectVoice(view, opts.micOn).catch((err) => {
				notifyError(
					`Voice couldn't start: ${err instanceof Error ? err.message : 'unknown error'}`,
				);
			});
		}

		if (opts.requestSync) this.requestSync();
	}

	private async connectVoice(view: SharedSessionView, micOn: boolean): Promise<void> {
		const me = currentUser.value;
		if (!me) return;

		const ice = await this.getIceConfig().catch(() => ({ iceServers: [] }) as IceConfig);

		await micAudioEngine.start();
		initVoiceEffects();
		voiceMuted.value = !micOn;
		micAudioEngine.setTrackEnabled(micOn);

		voiceMesh.init({
			sessionId: view.id,
			localUserId: me.id,
			iceServers: ice.iceServers,
			getLocalTrack: () => micAudioEngine.getProcessedTrack(),
			sendSignal: (msg) => wsService.send(WsEvent.SHARED_SESSION_SIGNAL, msg),
		});
		voiceMesh.syncPeers(this.joinedPeerIds(view));
		this.publishPresence({ muted: !micOn });
	}

	/** Ids of joined members other than us. */
	private joinedPeerIds(view: SharedSessionView): string[] {
		const me = currentUser.value?.id;
		return view.members
			.filter((m) => m.state === 'joined' && m.userId !== me)
			.map((m) => m.userId);
	}

	private becomeController(): void {
		startHeartbeat(() => this.broadcastLocalCommand('heartbeat', currentTime.value));
	}

	/** Ask the controller for an immediate heartbeat (fresh-join catch-up). */
	private requestSync(): void {
		const s = activeSession.value;
		const me = currentUser.value;
		if (!s || !me) return;
		wsService.send(WsEvent.SHARED_SESSION_PRESENCE, {
			sessionId: s.id,
			userId: me.id,
			request: 'sync',
		} satisfies PresenceEnvelope);
	}

	private publishPresence(patch: { muted?: boolean }): void {
		const s = activeSession.value;
		const me = currentUser.value;
		if (!s || !me) return;
		wsService.send(WsEvent.SHARED_SESSION_PRESENCE, {
			sessionId: s.id,
			presence: [
				{
					userId: me.id,
					muted: patch.muted ?? voiceMuted.value,
					speaking: false,
					ready: true,
					buffering: false,
				},
			],
		} satisfies PresenceEnvelope);
	}

	private teardownLocal(): void {
		stopHeartbeat();
		voiceMesh.teardown();
		micAudioEngine.destroy();
		const s = activeSession.value;
		if (s) wsService.unsubscribe(`session:${s.id}`);
		clearSessionState();
	}

	// ── Inbound handlers ──

	private onCommand(env: { sessionId: string; command: SessionCommand }): void {
		const s = activeSession.value;
		const cmd = env?.command;
		if (!s || !cmd || env.sessionId !== s.id) return;
		if (cmd.byUserId === currentUser.value?.id) return; // our own echo

		if (cmd.kind !== 'heartbeat') {
			// Someone else acted → they're the controller now; stop our heartbeat.
			stopHeartbeat();
		}
		applyRemoteCommand(cmd);
	}

	private onChat(env: { sessionId: string; message: ChatMessage }): void {
		const s = activeSession.value;
		const msg = env?.message;
		if (!s || !msg || env.sessionId !== s.id) return;
		if (chatMessages.value.some((m) => m.id === msg.id)) return;
		chatMessages.value = [...chatMessages.value, msg];
		if (!showChatWindow.value) chatUnread.value += 1;
	}

	private onSignal(msg: SignalMessage): void {
		const s = activeSession.value;
		if (!s || msg.sessionId !== s.id) return;
		void voiceMesh.handleSignal(msg);
	}

	private onPresence(env: PresenceEnvelope): void {
		const s = activeSession.value;
		if (!s || env.sessionId !== s.id) return;

		// A joiner asked for a sync heartbeat and we're the controller → oblige.
		if (env.request === 'sync') {
			this.broadcastLocalCommand('heartbeat', currentTime.value);
			return;
		}

		if (env.view) {
			activeSession.value = env.view;
			voiceMesh.syncPeers(this.joinedPeerIds(env.view));
		} else if (env.members) {
			const next = { ...s, members: env.members };
			activeSession.value = next;
			voiceMesh.syncPeers(this.joinedPeerIds(next));
		}

		if (env.presence) {
			const map = { ...peerPresence.value };
			for (const p of env.presence) map[p.userId] = { ...map[p.userId], ...p };
			peerPresence.value = map;
		}
	}

	private onSettings(env: { sessionId: string; settings: SharedSessionSettings }): void {
		const s = activeSession.value;
		if (!s || env.sessionId !== s.id) return;
		activeSession.value = {
			...s,
			settings: { ...DEFAULT_SHARED_SESSION_SETTINGS, ...env.settings },
		};
	}

	private onAdmin(env: { sessionId: string; adminUserId: string }): void {
		const s = activeSession.value;
		if (!s || env.sessionId !== s.id) return;
		activeSession.value = {
			...s,
			adminUserId: env.adminUserId,
			members: s.members.map((m) => ({
				...m,
				role: m.userId === env.adminUserId ? 'admin' : 'member',
			})),
		};
	}

	private onJoined(env: RosterEnvelope): void {
		const s = activeSession.value;
		if (!s || env.sessionId !== s.id) return;
		const view = env.view ?? this.mergeMember(s, env.member);
		if (!view) return;
		activeSession.value = view;
		voiceMesh.syncPeers(this.joinedPeerIds(view));
		if (env.member && env.member.userId !== currentUser.value?.id) {
			notifyInfo(`${env.member.name} joined the session`, 3000);
		}
	}

	private onLeft(env: RosterEnvelope): void {
		const s = activeSession.value;
		if (!s || env.sessionId !== s.id) return;
		const view = env.view ?? this.mergeMember(s, env.member, /*left*/ true);
		if (!view) return;
		activeSession.value = view;
		voiceMesh.syncPeers(this.joinedPeerIds(view));
		if (env.member) {
			const next = { ...peerPresence.value };
			delete next[env.member.userId];
			peerPresence.value = next;
		}
	}

	private onEnded(env: { sessionId: string }): void {
		const s = activeSession.value;
		if (!s || env.sessionId !== s.id) return;
		notifyInfo('The shared session has ended.', 4000);
		// Movie keeps playing solo; just tear down the session layer.
		this.teardownLocal();
	}

	private onNotification(n: NotificationDto): void {
		if (!n || n.type !== NotificationType.SharedSessionInvite) return;
		const data = n.data as unknown as SharedSessionInviteData;
		pendingInvite.value = data;
		// Centered flydown toast with an Accept action (the UI toast layer maps
		// the position; here we surface the invite + a one-click accept).
		notifyInfo(
			`🎬 ${data.hostName} invited you to watch ${data.movieTitle ?? 'a movie'}`,
			12000,
			[
				{
					label: 'Accept',
					onClick: () => {
						void this.joinSession(data.sessionId, { micOn: true });
						return undefined; // close the toast
					},
				},
			],
		);
	}

	private mergeMember(
		view: SharedSessionView,
		member: SharedSessionMemberView | undefined,
		left = false,
	): SharedSessionView | null {
		if (!member) return view;
		const others = view.members.filter((m) => m.userId !== member.userId);
		const members = left
			? [...others, { ...member, state: 'left' as const }]
			: [...others, member];
		return { ...view, members };
	}
}

export const sharedSessionService = new SharedSessionService();

// Shared types for the "Shared Sessions" (watch party) feature — used by the
// server (shared-sessions module + events gateway) and the client (session
// service/state/UI). See docs/shared-sessions-plan.md.

/** Admin-controlled per-session settings. */
export interface SharedSessionSettings {
	/** Members (not just admin) may play/pause. Default true. */
	allowMembersControl: boolean;
	/** Members may seek/scrub. Default mirrors allowMembersControl. */
	allowSeeking: boolean;
	/** Chat is available (the WS channel is open for sync either way). Default true. */
	enableChat: boolean;
	/** Voice chat is available. Default true. */
	enableVoice: boolean;
	/** Members (not just admin) may invite others. Default false. */
	allowMemberInvites: boolean;
	/** Open mic vs push-to-talk. Default 'open'. */
	voiceMode: 'open' | 'ptt';
	/** What happens if the admin disconnects. Default 'promote'. */
	onAdminDisconnect: 'promote' | 'end';
	/** Hard cap on concurrent members (guards the WebRTC mesh). Default 8. */
	maxMembers: number;
	/** Drift-correction strategy. Default 'soft'. */
	syncMode: 'soft' | 'hard' | 'wait-for-all';
	/** Buffered-ahead seconds required before (re)starting playback on join/play/seek. */
	prebufferSeconds: number;
	/** Drift (seconds) above which the client corrects; far past → hard seek. */
	driftThresholdSeconds: number;
	/** Show the bottom "X is talking" popup. Default true. */
	showSpeakingIndicator: boolean;
}

/** Sensible defaults for a newly-created session. */
export const DEFAULT_SHARED_SESSION_SETTINGS: SharedSessionSettings = {
	allowMembersControl: true,
	allowSeeking: true,
	enableChat: true,
	enableVoice: true,
	allowMemberInvites: false,
	voiceMode: 'open',
	onAdminDisconnect: 'promote',
	maxMembers: 8,
	syncMode: 'soft',
	prebufferSeconds: 5,
	driftThresholdSeconds: 1,
	showSpeakingIndicator: true,
};

/** Minimal member info for the invite picker — returned by
 *  `GET /members/invitable` regardless of the Show-Users-Info admin switch. */
export interface InvitableMember {
	id: string;
	name: string;
	avatarUrl: string | null;
}

export type SharedSessionRole = 'admin' | 'member';
export type SharedSessionMemberState = 'invited' | 'joined' | 'left';
export type SharedSessionStatus = 'active' | 'ended';

/** One member as seen by other clients. */
export interface SharedSessionMemberView {
	userId: string;
	name: string;
	avatarUrl: string | null;
	role: SharedSessionRole;
	state: SharedSessionMemberState;
}

/** Full session payload returned by REST + used to hydrate the client. */
export interface SharedSessionView {
	id: string;
	movieId: string;
	movieTitle?: string;
	adminUserId: string;
	name: string | null;
	status: SharedSessionStatus;
	settings: SharedSessionSettings;
	members: SharedSessionMemberView[];
	/** The requesting user's role, or null if not a member. */
	myRole: SharedSessionRole | null;
	createdAt: string;
}

/** A playback sync command relayed over the session channel. */
export interface SessionCommand {
	kind: 'play' | 'pause' | 'seek' | 'heartbeat';
	positionSeconds: number;
	/** Whether the controller is playing (for heartbeats). */
	playing?: boolean;
	/** Server/client clock stamp (ms epoch) for transit estimation. */
	at: number;
	byUserId: string;
	byName: string;
}

/** A chat message (persisted for the life of the session). */
export interface ChatMessage {
	id: string;
	sessionId: string;
	userId: string;
	name: string;
	text: string;
	at: string;
}

/** WebRTC signaling envelope relayed to a specific peer. */
export interface SignalMessage {
	sessionId: string;
	fromUserId: string;
	toUserId: string;
	kind: 'offer' | 'answer' | 'ice';
	payload: unknown;
}

/** A member's live voice/ready state (presence). */
export interface SharedSessionPresence {
	userId: string;
	muted: boolean;
	speaking: boolean;
	ready: boolean;
	buffering: boolean;
}

/** ICE config returned to clients for WebRTC voice. */
export interface IceConfig {
	iceServers: RTCIceServerConfig[];
}
export interface RTCIceServerConfig {
	urls: string | string[];
	username?: string;
	credential?: string;
}

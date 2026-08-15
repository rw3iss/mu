import { createHmac } from 'node:crypto';
import {
	type ChatMessage,
	DEFAULT_SHARED_SESSION_SETTINGS,
	type IceConfig,
	NotificationType,
	nowISO,
	type RTCIceServerConfig,
	type SessionCommand,
	type SharedSessionMemberView,
	type SharedSessionSettings,
	type SharedSessionView,
	WsEvent,
} from '@mu/shared';
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
	type OnModuleInit,
} from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
	movies,
	notifications,
	sharedSessionMembers,
	sharedSessionMessages,
	sharedSessions,
	users,
} from '../database/schema/index.js';
import { EventsGateway } from '../events/events.gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { SharedSessionRelay } from './shared-session-relay.interface.js';

/** Short-lived TURN credential validity. */
const TURN_TTL_SECONDS = 3600;
/** Public STUN fallback so voice works even without our coTURN. */
const PUBLIC_STUN = 'stun:stun.l.google.com:19302';

/**
 * A shared session untouched for this long is considered abandoned. Parties are
 * often just closed rather than explicitly ended, and an 'active' row lives
 * forever — which made `getMine` keep resurrecting it (and force-loading its
 * movie) on every app load. Generous enough to survive a long watch + refreshes.
 */
const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/** Cached relay state for the hot WS authorization path (heartbeats, chat). */
interface RelayState {
	adminUserId: string;
	settings: SharedSessionSettings;
	/** userIds of currently-joined members. */
	joined: Set<string>;
}

/**
 * "Watch party" sessions: a shared movie + synced playhead, chat, and voice
 * across members. This service owns session lifecycle (create/invite/join/
 * leave/transfer/end), settings, chat persistence, and the ICE config for
 * WebRTC voice. It also authorizes every WS relay against the AUTHENTICATED
 * socket identity (never a client-supplied userId) via `SharedSessionRelay`,
 * which it registers with the `EventsGateway` on init.
 */
@Injectable()
export class SharedSessionsService implements OnModuleInit, SharedSessionRelay {
	private readonly logger = new Logger('SharedSessions');
	/** Session-scoped relay authorization cache; busted on every mutation. */
	private readonly relayCache = new Map<string, RelayState>();

	constructor(
		private readonly database: DatabaseService,
		private readonly notifications: NotificationsService,
		private readonly gateway: EventsGateway,
		private readonly config: ConfigService,
	) {}

	onModuleInit(): void {
		// Callback registration (not injection) keeps the @Global gateway free of
		// a shared-sessions dependency — no DI cycle.
		this.gateway.registerSharedSessionRelay(this);
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	/** Create a session; the caller becomes the admin + first joined member. */
	create(adminUserId: string, movieId: string, name?: string): SharedSessionView {
		const movie = this.database.db
			.select({ id: movies.id })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		if (!movie) throw new NotFoundException('Movie not found');

		const id = crypto.randomUUID();
		const now = nowISO();
		this.database.db
			.insert(sharedSessions)
			.values({
				id,
				movieId,
				adminUserId,
				name: name?.trim() || null,
				settings: JSON.stringify(DEFAULT_SHARED_SESSION_SETTINGS),
				status: 'active',
				createdAt: now,
				updatedAt: now,
			})
			.run();
		this.database.db
			.insert(sharedSessionMembers)
			.values({
				id: crypto.randomUUID(),
				sessionId: id,
				userId: adminUserId,
				role: 'admin',
				state: 'joined',
				invitedBy: null,
				joinedAt: now,
			})
			.run();
		this.logger.debug(`Session ${id} created by ${adminUserId} for movie ${movieId}`);
		return this.getView(id, adminUserId);
	}

	/** Invite users; admin always, members only when `allowMemberInvites`. */
	invite(sessionId: string, byUserId: string, userIds: string[]): SharedSessionView {
		const row = this.requireActive(sessionId);
		const settings = this.parseSettings(row.settings);
		if (byUserId !== row.adminUserId && !settings.allowMemberInvites) {
			throw new ForbiddenException('Only the admin can invite to this session');
		}
		if (!this.isMember(byUserId, sessionId)) {
			throw new ForbiddenException('You are not a member of this session');
		}

		const movie = this.movieInfo(row.movieId);
		const hostName = this.userName(byUserId);
		const seen = new Set<string>();
		for (const uid of userIds ?? []) {
			if (typeof uid !== 'string' || uid === byUserId || seen.has(uid)) continue;
			seen.add(uid);
			const existing = this.memberRow(sessionId, uid);
			if (existing?.state === 'joined') continue; // already in
			if (existing) {
				this.database.db
					.update(sharedSessionMembers)
					.set({ state: 'invited', role: 'member', invitedBy: byUserId, leftAt: null })
					.where(eq(sharedSessionMembers.id, existing.id))
					.run();
			} else {
				this.database.db
					.insert(sharedSessionMembers)
					.values({
						id: crypto.randomUUID(),
						sessionId,
						userId: uid,
						role: 'member',
						state: 'invited',
						invitedBy: byUserId,
					})
					.run();
			}
			this.notifications.create(
				NotificationType.SharedSessionInvite,
				{
					sessionId,
					hostUserId: byUserId,
					hostName,
					movieId: row.movieId,
					movieTitle: movie.title,
					posterUrl: movie.posterUrl,
				},
				uid,
			);
		}
		return this.getView(sessionId, byUserId);
	}

	/** Accept/join. Rejects when ended, full, or not invited (no open join). */
	join(sessionId: string, userId: string): SharedSessionView {
		const row = this.requireExists(sessionId);
		if (row.status === 'ended') throw new ForbiddenException('This session has ended');
		const settings = this.parseSettings(row.settings);
		const existing = this.memberRow(sessionId, userId);
		// No public "open" join — a member row (invite) must already exist.
		if (!existing) throw new ForbiddenException('You have not been invited to this session');

		if (existing.state !== 'joined') {
			const joinedCount = this.joinedUserIds(sessionId).length;
			if (joinedCount >= settings.maxMembers) {
				throw new ForbiddenException('This session is full');
			}
			this.database.db
				.update(sharedSessionMembers)
				.set({ state: 'joined', joinedAt: nowISO(), leftAt: null })
				.where(eq(sharedSessionMembers.id, existing.id))
				.run();
			this.bustRelay(sessionId);
		}
		const view = this.getView(sessionId, userId);
		this.gateway.broadcastToChannel(`session:${sessionId}`, WsEvent.SHARED_SESSION_JOINED, {
			sessionId,
			member: view.members.find((m) => m.userId === userId) ?? null,
		});
		return view;
	}

	/** Leave. An admin leaving transfers first, or ends when last. */
	leave(sessionId: string, userId: string, newAdminUserId?: string): SharedSessionView | null {
		const row = this.requireExists(sessionId);
		const existing = this.memberRow(sessionId, userId);
		if (!existing || existing.state === 'left') return this.safeView(sessionId, userId);

		if (userId === row.adminUserId && row.status === 'active') {
			const others = this.joinedUserIds(sessionId).filter((u) => u !== userId);
			if (others.length === 0) {
				// Last member out → end the session.
				return this.end(sessionId, userId);
			}
			const target = newAdminUserId ?? others[0];
			if (!target || !others.includes(target)) {
				throw new BadRequestException('New admin must be a joined member');
			}
			this.transferAdmin(sessionId, userId, target);
		}

		this.database.db
			.update(sharedSessionMembers)
			.set({ state: 'left', leftAt: nowISO() })
			.where(eq(sharedSessionMembers.id, existing.id))
			.run();
		this.bustRelay(sessionId);
		this.gateway.broadcastToChannel(`session:${sessionId}`, WsEvent.SHARED_SESSION_LEFT, {
			sessionId,
			userId,
		});
		return this.safeView(sessionId, userId);
	}

	/** Hand the admin role to another joined member. */
	transferAdmin(sessionId: string, byUserId: string, newAdminUserId: string): SharedSessionView {
		const row = this.requireActive(sessionId);
		if (byUserId !== row.adminUserId) {
			throw new ForbiddenException('Only the admin can transfer the session');
		}
		const target = this.memberRow(sessionId, newAdminUserId);
		if (!target || target.state !== 'joined') {
			throw new BadRequestException('New admin must be a joined member');
		}
		const now = nowISO();
		this.database.db
			.update(sharedSessions)
			.set({ adminUserId: newAdminUserId, updatedAt: now })
			.where(eq(sharedSessions.id, sessionId))
			.run();
		this.database.db
			.update(sharedSessionMembers)
			.set({ role: 'member' })
			.where(
				and(
					eq(sharedSessionMembers.sessionId, sessionId),
					eq(sharedSessionMembers.userId, byUserId),
				),
			)
			.run();
		this.database.db
			.update(sharedSessionMembers)
			.set({ role: 'admin' })
			.where(
				and(
					eq(sharedSessionMembers.sessionId, sessionId),
					eq(sharedSessionMembers.userId, newAdminUserId),
				),
			)
			.run();
		this.bustRelay(sessionId);
		this.gateway.broadcastToChannel(`session:${sessionId}`, WsEvent.SHARED_SESSION_ADMIN, {
			sessionId,
			adminUserId: newAdminUserId,
		});
		return this.getView(sessionId, byUserId);
	}

	/** End the session (admin only); removes pending invite notifications. */
	end(sessionId: string, byUserId: string): SharedSessionView {
		const row = this.requireExists(sessionId);
		if (byUserId !== row.adminUserId) {
			throw new ForbiddenException('Only the admin can end this session');
		}
		if (row.status !== 'ended') {
			const now = nowISO();
			this.database.db
				.update(sharedSessions)
				.set({ status: 'ended', endedAt: now, updatedAt: now })
				.where(eq(sharedSessions.id, sessionId))
				.run();
		}
		this.bustRelay(sessionId);
		this.gateway.broadcastToChannel(`session:${sessionId}`, WsEvent.SHARED_SESSION_ENDED, {
			sessionId,
		});
		this.removePendingInvites(sessionId);
		this.logger.debug(`Session ${sessionId} ended by ${byUserId}`);
		return this.getView(sessionId, byUserId);
	}

	/** Merge + persist a settings patch (admin only); broadcasts the result. */
	updateSettings(
		sessionId: string,
		byUserId: string,
		patch: Partial<SharedSessionSettings>,
	): SharedSessionView {
		const row = this.requireActive(sessionId);
		if (byUserId !== row.adminUserId) {
			throw new ForbiddenException('Only the admin can change settings');
		}
		const merged = { ...this.parseSettings(row.settings), ...this.sanitizeSettings(patch) };
		this.database.db
			.update(sharedSessions)
			.set({ settings: JSON.stringify(merged), updatedAt: nowISO() })
			.where(eq(sharedSessions.id, sessionId))
			.run();
		this.bustRelay(sessionId);
		this.gateway.broadcastToChannel(`session:${sessionId}`, WsEvent.SHARED_SESSION_SETTINGS, {
			sessionId,
			settings: merged,
		});
		return this.getView(sessionId, byUserId);
	}

	// ── Reads ───────────────────────────────────────────────────────────────

	/** Full session view for `forUserId` (roster + my role). */
	getView(sessionId: string, forUserId: string): SharedSessionView {
		const row = this.requireExists(sessionId);
		const movie = this.movieInfo(row.movieId);
		const memberRows = this.database.db
			.select({
				userId: sharedSessionMembers.userId,
				role: sharedSessionMembers.role,
				state: sharedSessionMembers.state,
				joinedAt: sharedSessionMembers.joinedAt,
				username: users.username,
				displayName: users.displayName,
				avatarUrl: users.avatarUrl,
			})
			.from(sharedSessionMembers)
			.leftJoin(users, eq(sharedSessionMembers.userId, users.id))
			.where(eq(sharedSessionMembers.sessionId, sessionId))
			.orderBy(asc(sharedSessionMembers.joinedAt))
			.all();

		const members: SharedSessionMemberView[] = memberRows
			.filter((m) => m.state !== 'left')
			.map((m) => ({
				userId: m.userId,
				name: m.displayName?.trim() || m.username || 'Unknown',
				avatarUrl: m.avatarUrl ?? null,
				role: m.role === 'admin' ? 'admin' : 'member',
				state: m.state === 'joined' ? 'joined' : 'invited',
			}));

		const mine = memberRows.find((m) => m.userId === forUserId && m.state !== 'left');
		return {
			id: row.id,
			movieId: row.movieId,
			movieTitle: movie.title,
			adminUserId: row.adminUserId,
			name: row.name,
			status: row.status === 'ended' ? 'ended' : 'active',
			settings: this.parseSettings(row.settings),
			members,
			myRole: mine ? (mine.role === 'admin' ? 'admin' : 'member') : null,
			createdAt: row.createdAt,
		};
	}

	/**
	 * The caller's active session (joined + status active), or null.
	 *
	 * Sessions that haven't been touched within {@link STALE_SESSION_MS} are
	 * treated as ABANDONED: they're marked ended and not returned. Without this
	 * a party nobody ever explicitly ended stayed 'active' forever, and the
	 * client's hydrate() re-joined it on every single app load — which
	 * force-loaded that movie into the player days later.
	 */
	getMine(userId: string): SharedSessionView | null {
		const row = this.database.db
			.select({
				sessionId: sharedSessionMembers.sessionId,
				updatedAt: sharedSessions.updatedAt,
				createdAt: sharedSessions.createdAt,
			})
			.from(sharedSessionMembers)
			.innerJoin(sharedSessions, eq(sharedSessionMembers.sessionId, sharedSessions.id))
			.where(
				and(
					eq(sharedSessionMembers.userId, userId),
					eq(sharedSessionMembers.state, 'joined'),
					eq(sharedSessions.status, 'active'),
				),
			)
			.orderBy(desc(sharedSessions.createdAt))
			.get();
		if (!row) return null;

		const touched = Date.parse(row.updatedAt ?? row.createdAt ?? '');
		if (Number.isFinite(touched) && Date.now() - touched > STALE_SESSION_MS) {
			this.endStale(row.sessionId);
			return null;
		}

		return this.getView(row.sessionId, userId);
	}

	/** Mark an abandoned session ended so it stops being resurrected. */
	private endStale(sessionId: string): void {
		const now = nowISO();
		this.database.db
			.update(sharedSessions)
			.set({ status: 'ended', endedAt: now, updatedAt: now })
			.where(eq(sharedSessions.id, sessionId))
			.run();
		this.logger.log(`Auto-ended abandoned shared session ${sessionId}`);
	}

	/** Chat backlog for a session, oldest first. */
	listMessages(sessionId: string): ChatMessage[] {
		const rows = this.database.db
			.select({
				id: sharedSessionMessages.id,
				sessionId: sharedSessionMessages.sessionId,
				userId: sharedSessionMessages.userId,
				text: sharedSessionMessages.text,
				createdAt: sharedSessionMessages.createdAt,
				username: users.username,
				displayName: users.displayName,
			})
			.from(sharedSessionMessages)
			.leftJoin(users, eq(sharedSessionMessages.userId, users.id))
			.where(eq(sharedSessionMessages.sessionId, sessionId))
			.orderBy(asc(sharedSessionMessages.createdAt))
			.all();
		return rows.map((r) => ({
			id: r.id,
			sessionId: r.sessionId,
			userId: r.userId,
			name: r.displayName?.trim() || r.username || 'Unknown',
			text: r.text,
			at: r.createdAt,
		}));
	}

	/** Persist a chat message + return its view (no relay — caller relays). */
	addMessage(sessionId: string, userId: string, text: string): ChatMessage {
		const clean = (text ?? '').trim().slice(0, 2000);
		if (!clean) throw new BadRequestException('Message text is required');
		const id = crypto.randomUUID();
		const at = nowISO();
		this.database.db
			.insert(sharedSessionMessages)
			.values({ id, sessionId, userId, text: clean, createdAt: at })
			.run();
		return { id, sessionId, userId, name: this.userName(userId), text: clean, at };
	}

	/** STUN + short-lived HMAC TURN credentials for WebRTC voice. */
	iceConfig(userId: string): IceConfig {
		const iceServers: RTCIceServerConfig[] = [];
		const enabled = this.config.get<boolean>('turn.enabled', false) === true;
		const host = this.config.get<string>('turn.publicHost', '');
		const secret = this.config.get<string>('turn.secret', '');
		if (enabled && host && secret) {
			iceServers.push({ urls: [`stun:${host}:3478`] });
			const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
			const username = `${expiry}:${userId}`;
			const credential = createHmac('sha1', secret).update(username).digest('base64');
			iceServers.push({
				urls: [
					`turn:${host}:3478?transport=udp`,
					`turn:${host}:3478?transport=tcp`,
					`turns:${host}:5349?transport=tcp`,
				],
				username,
				credential,
			});
		}
		// Extra operator-supplied STUN URLs, then the public Google fallback.
		for (const u of this.config.get<string[]>('turn.stunUrls', []) ?? []) {
			if (typeof u === 'string' && u) iceServers.push({ urls: u });
		}
		iceServers.push({ urls: PUBLIC_STUN });
		return { iceServers };
	}

	// ── SharedSessionRelay (WS authorization; identity is authenticated) ──────

	canRelayCommand(userId: string, sessionId: string, kind: SessionCommand['kind']): boolean {
		const state = this.relayState(sessionId);
		if (!state || !state.joined.has(userId)) return false;
		const isAdmin = userId === state.adminUserId;
		switch (kind) {
			case 'heartbeat':
				return true; // any joined member may be the heartbeat source
			case 'play':
			case 'pause':
				return isAdmin || state.settings.allowMembersControl;
			case 'seek':
				return (
					isAdmin || (state.settings.allowMembersControl && state.settings.allowSeeking)
				);
			default:
				return false;
		}
	}

	isMember(userId: string, sessionId: string): boolean {
		const state = this.relayState(sessionId);
		return !!state && state.joined.has(userId);
	}

	recordChat(userId: string, sessionId: string, text: string): ChatMessage | null {
		const state = this.relayState(sessionId);
		if (!state || !state.joined.has(userId) || !state.settings.enableChat) return null;
		const clean = (text ?? '').trim();
		if (!clean) return null;
		return this.addMessage(sessionId, userId, clean);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	/** Cached admin/settings/joined-set for the hot relay path. */
	private relayState(sessionId: string): RelayState | null {
		const cached = this.relayCache.get(sessionId);
		if (cached) return cached;
		const row = this.database.db
			.select()
			.from(sharedSessions)
			.where(eq(sharedSessions.id, sessionId))
			.get();
		if (!row || row.status !== 'active') return null;
		const state: RelayState = {
			adminUserId: row.adminUserId,
			settings: this.parseSettings(row.settings),
			joined: new Set(this.joinedUserIds(sessionId)),
		};
		this.relayCache.set(sessionId, state);
		return state;
	}

	private bustRelay(sessionId: string): void {
		this.relayCache.delete(sessionId);
	}

	private requireExists(sessionId: string): typeof sharedSessions.$inferSelect {
		const row = this.database.db
			.select()
			.from(sharedSessions)
			.where(eq(sharedSessions.id, sessionId))
			.get();
		if (!row) throw new NotFoundException('Session not found');
		return row;
	}

	private requireActive(sessionId: string): typeof sharedSessions.$inferSelect {
		const row = this.requireExists(sessionId);
		if (row.status !== 'active') throw new ForbiddenException('This session has ended');
		return row;
	}

	private memberRow(sessionId: string, userId: string) {
		return this.database.db
			.select()
			.from(sharedSessionMembers)
			.where(
				and(
					eq(sharedSessionMembers.sessionId, sessionId),
					eq(sharedSessionMembers.userId, userId),
				),
			)
			.get();
	}

	private joinedUserIds(sessionId: string): string[] {
		return this.database.db
			.select({ userId: sharedSessionMembers.userId })
			.from(sharedSessionMembers)
			.where(
				and(
					eq(sharedSessionMembers.sessionId, sessionId),
					eq(sharedSessionMembers.state, 'joined'),
				),
			)
			.all()
			.map((r) => r.userId);
	}

	private removePendingInvites(sessionId: string): void {
		this.database.db.run(
			sql`DELETE FROM ${notifications} WHERE ${notifications.type} = ${String(NotificationType.SharedSessionInvite)} AND json_extract(${notifications.data}, '$.sessionId') = ${sessionId}`,
		);
	}

	private movieInfo(movieId: string): { title?: string; posterUrl: string | null } {
		const m = this.database.db
			.select({ title: movies.title, posterUrl: movies.posterUrl })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		return { title: m?.title, posterUrl: m?.posterUrl ?? null };
	}

	private userName(userId: string): string {
		const u = this.database.db
			.select({
				name: sql<string>`COALESCE(${users.displayName}, ${users.username}, 'Someone')`,
			})
			.from(users)
			.where(eq(users.id, userId))
			.get();
		return u?.name ?? 'Someone';
	}

	private parseSettings(raw: string): SharedSessionSettings {
		try {
			return { ...DEFAULT_SHARED_SESSION_SETTINGS, ...JSON.parse(raw) };
		} catch {
			return { ...DEFAULT_SHARED_SESSION_SETTINGS };
		}
	}

	/** Whitelist + type-check an incoming settings patch. */
	private sanitizeSettings(
		patch: Partial<SharedSessionSettings>,
	): Partial<SharedSessionSettings> {
		const out: Partial<SharedSessionSettings> = {};
		if (!patch || typeof patch !== 'object') return out;
		const bool = (k: keyof SharedSessionSettings) => {
			if (typeof patch[k] === 'boolean') (out as Record<string, unknown>)[k] = patch[k];
		};
		bool('allowMembersControl');
		bool('allowSeeking');
		bool('enableChat');
		bool('enableVoice');
		bool('allowMemberInvites');
		bool('showSpeakingIndicator');
		if (patch.voiceMode === 'open' || patch.voiceMode === 'ptt')
			out.voiceMode = patch.voiceMode;
		if (patch.onAdminDisconnect === 'promote' || patch.onAdminDisconnect === 'end') {
			out.onAdminDisconnect = patch.onAdminDisconnect;
		}
		if (
			patch.syncMode === 'soft' ||
			patch.syncMode === 'hard' ||
			patch.syncMode === 'wait-for-all'
		) {
			out.syncMode = patch.syncMode;
		}
		if (typeof patch.maxMembers === 'number' && patch.maxMembers >= 1) {
			out.maxMembers = Math.min(32, Math.floor(patch.maxMembers));
		}
		if (typeof patch.prebufferSeconds === 'number' && patch.prebufferSeconds >= 0) {
			out.prebufferSeconds = Math.min(60, patch.prebufferSeconds);
		}
		if (typeof patch.driftThresholdSeconds === 'number' && patch.driftThresholdSeconds >= 0) {
			out.driftThresholdSeconds = Math.min(30, patch.driftThresholdSeconds);
		}
		return out;
	}

	/** getView that swallows a not-found (post-end race) into null. */
	private safeView(sessionId: string, userId: string): SharedSessionView | null {
		try {
			return this.getView(sessionId, userId);
		} catch {
			return null;
		}
	}
}

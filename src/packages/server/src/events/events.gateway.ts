import type { IncomingMessage } from 'node:http';
import { WsEvent } from '@mu/shared';
import { Logger } from '@nestjs/common';
import {
	ConnectedSocket,
	MessageBody,
	OnGatewayConnection,
	OnGatewayDisconnect,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { EventsService } from './events.service.js';
import { WsAuthService } from './ws-auth.service.js';

interface ClientMeta {
	channels: Set<string>;
	userId?: string;
	role?: string;
}

@WebSocketGateway({ path: '/ws' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger('WebSocket');
	private clients = new Map<WebSocket, ClientMeta>();

	@WebSocketServer()
	server!: Server;

	constructor(
		private events: EventsService,
		private wsAuth: WsAuthService,
	) {
		// Listen for internal events and broadcast to subscribed clients
		const broadcastEvents = [
			WsEvent.LIBRARY_MOVIE_ADDED,
			WsEvent.LIBRARY_MOVIE_UPDATED,
			WsEvent.LIBRARY_MOVIE_REMOVED,
			WsEvent.SCAN_STARTED,
			WsEvent.SCAN_PROGRESS,
			WsEvent.SCAN_COMPLETED,
			WsEvent.SCAN_ERROR,
			WsEvent.STREAM_STARTED,
			WsEvent.STREAM_ENDED,
			WsEvent.STREAM_SUPERSEDED,
			WsEvent.WATCH_STATUS_CHANGED,
			WsEvent.JOB_STARTED,
			WsEvent.JOB_PROGRESS,
			WsEvent.JOB_COMPLETED,
			WsEvent.JOB_FAILED,
			WsEvent.SERVER_STATUS,
			WsEvent.UPLOAD_PROGRESS,
			WsEvent.UPLOAD_COMPLETED,
		];

		for (const event of broadcastEvents) {
			this.events.on(event, (data: unknown) => {
				this.broadcast(event, data);
			});
		}

		// Notifications are user-targeted: deliver only to the recipient's
		// sockets (data.userId), or to EVERY socket when userId is null
		// (system-wide). Clients still must be subscribed to the
		// 'notification' channel.
		this.events.on(WsEvent.NOTIFICATION, (data: unknown) => {
			this.deliverNotification(data);
		});
	}

	/**
	 * Notifications route by CHANNEL: personal → `user:<userId>`, system-wide
	 * (userId null) → `global`. Channel subscriptions survive WS reconnects, so
	 * delivery is robust without a separate identity handshake.
	 */
	private deliverNotification(data: unknown): void {
		const targetUserId = (data as { userId?: string | null })?.userId ?? null;
		const channel = targetUserId ? `user:${targetUserId}` : 'global';
		this.broadcastToChannel(channel, WsEvent.NOTIFICATION, data);
	}

	/** Send an event to every OPEN client subscribed to `channel`. */
	broadcastToChannel(channel: string, event: string, data: unknown): void {
		const message = JSON.stringify({ event, data });
		for (const [client, meta] of this.clients) {
			if (client.readyState === WebSocket.OPEN && meta.channels.has(channel)) {
				client.send(message);
			}
		}
	}

	handleConnection(client: WebSocket, request?: IncomingMessage) {
		// Authenticate the upgrade (JWT via ?token= or cookie). Anonymous sockets
		// are still allowed (they only ever receive PUBLIC broadcasts — scan,
		// library, stream, etc.), but a verified identity is required to
		// subscribe to a `user:<id>` / `session:<id>` channel (see below). This
		// closes the impersonation hole without regressing share/`/watch` sockets.
		const identity = this.wsAuth.verify(request);
		const meta: ClientMeta = { channels: new Set() };
		if (identity) {
			meta.userId = identity.userId;
			meta.role = identity.role;
		}
		this.clients.set(client, meta);
		this.logger.debug(
			`Client connected${identity ? ` (user ${identity.userId})` : ' (anon)'} (${this.clients.size} total)`,
		);
	}

	handleDisconnect(client: WebSocket) {
		this.clients.delete(client);
		this.logger.debug(`Client disconnected (${this.clients.size} total)`);
	}

	/** The authenticated identity for a socket, if any (used by relay handlers). */
	getIdentity(client: WebSocket): { userId: string; role: string } | null {
		const meta = this.clients.get(client);
		return meta?.userId ? { userId: meta.userId, role: meta.role ?? 'viewer' } : null;
	}

	/**
	 * Guard privileged channels. `user:<id>` may only be joined by that user;
	 * `session:<id>` requires an authenticated identity (membership is enforced
	 * per-command by the SharedSessions relay handlers in Phase 2). Public
	 * channels are unrestricted.
	 */
	private canSubscribe(meta: ClientMeta, channel: string): boolean {
		if (!this.wsAuth.enforce) return true;
		if (channel.startsWith('user:')) {
			return !!meta.userId && channel === `user:${meta.userId}`;
		}
		if (channel.startsWith('session:')) {
			return !!meta.userId;
		}
		return true;
	}

	@SubscribeMessage(WsEvent.SUBSCRIBE)
	handleSubscribe(@ConnectedSocket() client: WebSocket, @MessageBody() data: unknown) {
		const meta = this.clients.get(client);
		if (!meta) return;
		// Client sends { channel: "library" } — extract the string
		const channel = typeof data === 'string' ? data : (data as any)?.channel;
		if (typeof channel === 'string') {
			if (!this.canSubscribe(meta, channel)) {
				this.logger.warn(
					`Rejected subscribe to "${channel}" (user=${meta.userId ?? 'anon'})`,
				);
				return;
			}
			meta.channels.add(channel);
			this.logger.debug(`Client subscribed to: ${channel}`);
		}
	}

	@SubscribeMessage(WsEvent.UNSUBSCRIBE)
	handleUnsubscribe(@ConnectedSocket() client: WebSocket, @MessageBody() data: unknown) {
		const meta = this.clients.get(client);
		if (!meta) return;
		const channel = typeof data === 'string' ? data : (data as any)?.channel;
		if (typeof channel === 'string') {
			meta.channels.delete(channel);
		}
	}

	broadcast(eventOrChannel: string, data: unknown) {
		const message = JSON.stringify({ event: eventOrChannel, data });
		for (const [client, meta] of this.clients) {
			if (client.readyState === WebSocket.OPEN) {
				// Send to clients subscribed to this event's channel prefix
				const channel = eventOrChannel.split(':')[0];
				if (meta.channels.has(eventOrChannel) || meta.channels.has(channel ?? '')) {
					client.send(message);
				}
			}
		}
	}

	getConnectedCount(): number {
		return this.clients.size;
	}
}

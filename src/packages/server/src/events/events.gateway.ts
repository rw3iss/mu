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

interface ClientMeta {
	channels: Set<string>;
	userId?: string;
}

@WebSocketGateway({ path: '/ws' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger('WebSocket');
	private clients = new Map<WebSocket, ClientMeta>();

	@WebSocketServer()
	server!: Server;

	constructor(private events: EventsService) {
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
			WsEvent.JOB_STARTED,
			WsEvent.JOB_PROGRESS,
			WsEvent.JOB_COMPLETED,
			WsEvent.JOB_FAILED,
			WsEvent.SERVER_STATUS,
			WsEvent.NOTIFICATION,
		];

		for (const event of broadcastEvents) {
			this.events.on(event, (data: unknown) => {
				this.broadcast(event, data);
			});
		}
	}

	handleConnection(client: WebSocket) {
		this.clients.set(client, { channels: new Set() });
		this.logger.debug(`Client connected (${this.clients.size} total)`);
	}

	handleDisconnect(client: WebSocket) {
		this.clients.delete(client);
		this.logger.debug(`Client disconnected (${this.clients.size} total)`);
	}

	@SubscribeMessage(WsEvent.SUBSCRIBE)
	handleSubscribe(@ConnectedSocket() client: WebSocket, @MessageBody() channel: string) {
		const meta = this.clients.get(client);
		if (meta) {
			meta.channels.add(channel);
			this.logger.debug(`Client subscribed to: ${channel}`);
		}
	}

	@SubscribeMessage(WsEvent.UNSUBSCRIBE)
	handleUnsubscribe(@ConnectedSocket() client: WebSocket, @MessageBody() channel: string) {
		const meta = this.clients.get(client);
		if (meta) {
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

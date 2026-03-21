// ============================================
// Types
// ============================================

type EventHandler = (data: unknown) => void;

interface WSMessage {
	event: string;
	data: unknown;
}

// ============================================
// WebSocket Service
// ============================================

class WebSocketService {
	private ws: WebSocket | null = null;
	private handlers = new Map<string, Set<EventHandler>>();
	private subscriptions = new Set<string>();
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private isConnecting = false;
	private url: string;

	constructor() {
		// Support standalone client pointing to a remote server
		const apiUrl =
			(typeof import.meta.env?.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL) ||
			localStorage.getItem('mu_api_url') ||
			'';

		if (apiUrl) {
			// Derive WebSocket URL from API URL (https://host/api/v1 → wss://host/ws)
			const url = new URL(apiUrl);
			const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
			this.url = `${wsProtocol}//${url.host}/ws`;
		} else {
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			this.url = `${protocol}//${window.location.host}/ws`;
		}
	}

	/**
	 * Connect to the WebSocket server
	 */
	connect(): void {
		if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
			return;
		}

		this.isConnecting = true;
		const token = localStorage.getItem('mu_token');
		const url = token ? `${this.url}?token=${encodeURIComponent(token)}` : this.url;

		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			this.isConnecting = false;
			this.reconnectAttempts = 0;
			console.log('[WS] Connected');

			// Re-subscribe to channels after reconnection
			for (const channel of this.subscriptions) {
				this.send('subscribe', { channel });
			}
		};

		this.ws.onmessage = (event) => {
			try {
				const message: WSMessage = JSON.parse(event.data);
				this.emit(message.event, message.data);
			} catch (error) {
				console.error('[WS] Failed to parse message:', error);
			}
		};

		this.ws.onclose = (event) => {
			this.isConnecting = false;
			console.log(`[WS] Disconnected (code: ${event.code})`);

			if (!event.wasClean) {
				this.scheduleReconnect();
			}
		};

		this.ws.onerror = (error) => {
			this.isConnecting = false;
			console.error('[WS] Error:', error);
		};
	}

	/**
	 * Disconnect from the WebSocket server
	 */
	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.reconnectAttempts = this.maxReconnectAttempts;

		if (this.ws) {
			this.ws.close(1000, 'Client disconnect');
			this.ws = null;
		}
	}

	/**
	 * Subscribe to a channel
	 */
	subscribe(channel: string): void {
		this.subscriptions.add(channel);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.send('subscribe', { channel });
		}
	}

	/**
	 * Unsubscribe from a channel
	 */
	unsubscribe(channel: string): void {
		this.subscriptions.delete(channel);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.send('unsubscribe', { channel });
		}
	}

	/**
	 * Register an event handler
	 */
	on(event: string, handler: EventHandler): void {
		if (!this.handlers.has(event)) {
			this.handlers.set(event, new Set());
		}
		this.handlers.get(event)!.add(handler);
	}

	/**
	 * Remove an event handler
	 */
	off(event: string, handler: EventHandler): void {
		const handlers = this.handlers.get(event);
		if (handlers) {
			handlers.delete(handler);
			if (handlers.size === 0) {
				this.handlers.delete(event);
			}
		}
	}

	/**
	 * Send a message to the server
	 */
	send(event: string, data: unknown = {}): void {
		if (this.ws?.readyState !== WebSocket.OPEN) {
			console.warn('[WS] Cannot send message, not connected');
			return;
		}

		const message: WSMessage = { event, data };
		this.ws.send(JSON.stringify(message));
	}

	// ============================================
	// Private Methods
	// ============================================

	private emit(event: string, data: unknown): void {
		const handlers = this.handlers.get(event);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(data);
				} catch (error) {
					console.error(`[WS] Error in handler for "${event}":`, error);
				}
			}
		}

		// Also emit to wildcard handlers
		const wildcardHandlers = this.handlers.get('*');
		if (wildcardHandlers) {
			for (const handler of wildcardHandlers) {
				try {
					handler({ event, data });
				} catch (error) {
					console.error('[WS] Error in wildcard handler:', error);
				}
			}
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error('[WS] Max reconnection attempts reached');
			return;
		}

		// Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
		const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);

		console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectAttempts++;
			this.connect();
		}, delay);
	}
}

export const wsService = new WebSocketService();

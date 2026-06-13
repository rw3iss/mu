import { effect } from '@preact/signals';
import { currentUser } from '@/state/auth.state';
import { wsService } from './websocket.service';

type Handler = (data: unknown) => void;

/**
 * Central client-side socket manager. One place that:
 *  - owns the channel model: a shared `global` channel (system-wide events) +
 *    a per-user `user:<id>` channel that follows the logged-in user;
 *  - delegates incoming events to domain handlers registered via `on()`.
 *
 * Channel subscriptions are held by wsService and re-applied automatically on
 * every (re)connect, so delivery survives drops without an identity handshake.
 * Domain modules (notifications, and future live features) register handlers
 * here so the wiring lives in one auditable spot. Built to grow — add a channel
 * + a handler and the rest is automatic.
 */
class SocketManager {
	private started = false;
	private currentUserChannel: string | null = null;

	/** Wire up channels + react to login/logout. Idempotent. */
	start(): void {
		if (this.started) return;
		this.started = true;

		// Shared firehose for system-wide events (announcements, etc.).
		wsService.subscribe('global');

		// Follow the logged-in user: subscribe `user:<id>`, swap on change,
		// drop on logout.
		effect(() => {
			const uid = currentUser.value?.id ?? null;
			const next = uid ? `user:${uid}` : null;
			if (next === this.currentUserChannel) return;
			if (this.currentUserChannel) wsService.unsubscribe(this.currentUserChannel);
			if (next) wsService.subscribe(next);
			this.currentUserChannel = next;
		});
	}

	/** Register a delegated handler for a server event. Returns an unsubscribe. */
	on(event: string, handler: Handler): () => void {
		wsService.on(event, handler);
		return () => wsService.off(event, handler);
	}
}

export const socketManager = new SocketManager();

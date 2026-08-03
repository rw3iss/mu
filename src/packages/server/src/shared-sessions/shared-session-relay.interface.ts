import type { ChatMessage, SessionCommand } from '@mu/shared';

/**
 * The narrow surface the `EventsGateway` relay handlers need from
 * `SharedSessionsService`. Registered via a callback (not injected) so the
 * `@Global` gateway never takes a hard dependency on the shared-sessions
 * module — avoids the DI cycle (service → gateway, gateway → service).
 *
 * Every method authorizes against the AUTHENTICATED socket identity; the
 * gateway never trusts a userId supplied in the message payload.
 */
export interface SharedSessionRelay {
	/** May `userId` relay a command of `kind` into `sessionId` right now? */
	canRelayCommand(userId: string, sessionId: string, kind: SessionCommand['kind']): boolean;
	/** Is `userId` a currently-joined member of `sessionId`? */
	isMember(userId: string, sessionId: string): boolean;
	/**
	 * Persist + return a chat message, or `null` if it must not be relayed
	 * (not a joined member, chat disabled, or empty text).
	 */
	recordChat(userId: string, sessionId: string, text: string): ChatMessage | null;
}

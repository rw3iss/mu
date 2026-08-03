import {
	type AnnouncementData,
	type CommentReactionData,
	type CommentReplyData,
	type NewTitleData,
	type NotificationDto,
	NotificationType,
	type SharedSessionInviteData,
} from '@mu/shared';

export interface FormattedNotification {
	/** Headline message text. */
	message: string;
	/** Where clicking navigates (in-app path), or null. */
	href: string | null;
	/** Originating user (links to their profile), if any. */
	actorId?: string | null;
	actorName?: string | null;
	/** Optional small icon/emoji to show. */
	icon?: string;
}

/**
 * Per-type formatter: turns a notification's open `data` into a message + link.
 * Centralised here so every surface (panel, toast) renders identically and new
 * types are added in one place.
 */
export function formatNotification(n: NotificationDto): FormattedNotification {
	const d = n.data as Record<string, unknown>;
	switch (n.type) {
		case NotificationType.CommentReply: {
			const r = d as unknown as CommentReplyData;
			return {
				message: `${r.fromUserName} replied to your comment${r.movieTitle ? ` on ${r.movieTitle}` : ''}`,
				href: `/movie/${r.movieId}?comment=${r.replyId ?? r.commentId}`,
				actorId: r.fromUserId,
				actorName: r.fromUserName,
				icon: '💬',
			};
		}
		case NotificationType.CommentReaction: {
			const r = d as unknown as CommentReactionData;
			return {
				message: `${r.fromUserName} reacted ${r.emoji} to your comment${r.movieTitle ? ` on ${r.movieTitle}` : ''}`,
				href: `/movie/${r.movieId}?comment=${r.commentId}`,
				actorId: r.fromUserId,
				actorName: r.fromUserName,
				icon: r.emoji || '🙂',
			};
		}
		case NotificationType.NewTitle: {
			const r = d as unknown as NewTitleData;
			return {
				message: `New title added: ${r.title}`,
				href: `/movie/${r.movieId}`,
				icon: '🎬',
			};
		}
		case NotificationType.SharedSessionInvite: {
			const r = d as unknown as SharedSessionInviteData;
			return {
				message: `${r.hostName} invited you to watch ${r.movieTitle ?? 'a movie'}`,
				// Clicking routes to the movie; the invite's Accept flow lives in
				// the shared-session service (bell + flydown both call joinSession).
				href: `/movie/${r.movieId}`,
				actorId: r.hostUserId,
				actorName: r.hostName,
				icon: '🎬',
			};
		}
		case NotificationType.Announcement: {
			const r = d as unknown as AnnouncementData;
			return {
				message: r.title + (r.body ? ` — ${r.body}` : ''),
				href: r.link ?? null,
				icon: '📢',
			};
		}
		default:
			return {
				message: typeof d.message === 'string' ? d.message : 'Notification',
				href: typeof d.link === 'string' ? d.link : null,
			};
	}
}

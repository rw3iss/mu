/**
 * Notification types. Each value is the stored `type` string. The client maps
 * these to a formatter (message + link) — see the client's notification-format.
 */
export enum NotificationType {
	/** Someone replied to your comment. data: CommentReplyData */
	CommentReply = 'comment-reply',
	/** Someone reacted to your comment. data: CommentReactionData */
	CommentReaction = 'comment-reaction',
	/** A new title was added to the library. data: NewTitleData */
	NewTitle = 'new-title',
	/** Admin/system announcement shown to everyone. data: AnnouncementData */
	Announcement = 'announcement',
}

export interface CommentReplyData {
	fromUserId: string;
	fromUserName: string;
	movieId: string;
	movieTitle?: string;
	commentId: string;
	replyId: string;
	snippet?: string;
}

export interface CommentReactionData {
	fromUserId: string;
	fromUserName: string;
	movieId: string;
	movieTitle?: string;
	commentId: string;
	emoji: string;
	snippet?: string;
}

export interface NewTitleData {
	movieId: string;
	title: string;
	posterUrl?: string | null;
}

export interface AnnouncementData {
	title: string;
	body?: string;
	link?: string;
}

export interface NotificationDto {
	id: string;
	/** Null = system-wide (shown to all users). */
	userId: string | null;
	type: NotificationType | string;
	data: Record<string, unknown>;
	read: boolean;
	createdAt: string;
}

import { api } from './api';

export interface CommentReactionSummary {
	emoji: string;
	count: number;
	mine: boolean;
}

export interface MovieComment {
	id: string;
	movieId: string;
	userId: string;
	parentId: string | null;
	timeSeconds: number | null;
	text: string;
	edited: boolean;
	createdAt: string;
	updatedAt: string;
	authorName: string;
	reactions: CommentReactionSummary[];
	replies?: MovieComment[];
}

export interface CommentsResponse {
	comments: MovieComment[];
	count?: number;
}

export interface UserCommentRow {
	id: string;
	movieId: string;
	parentId: string | null;
	timeSeconds: number | null;
	text: string;
	edited: boolean;
	createdAt: string;
	movieTitle: string | null;
	movieYear: number | null;
	moviePosterUrl: string | null;
	movieThumbnailUrl: string | null;
}

export const commentsService = {
	/** A user's comments across all movies, newest first, pageable. */
	listByUser(
		userId: string,
		page = 1,
		pageSize = 20,
	): Promise<{ comments: UserCommentRow[]; page: number; hasMore: boolean }> {
		return api.get(`/comments/user/${userId}`, {
			page: String(page),
			pageSize: String(pageSize),
		});
	},

	/** Comment tree for a movie (server-cached). Works with share tokens too. */
	list(movieId: string): Promise<CommentsResponse> {
		return api.get<CommentsResponse>(`/comments/movie/${movieId}`);
	},

	create(
		movieId: string,
		body: { text: string; timeSeconds?: number | null; parentId?: string | null },
	): Promise<CommentsResponse> {
		return api.post<CommentsResponse>(`/comments/movie/${movieId}`, body);
	},

	update(
		id: string,
		body: { text?: string; timeSeconds?: number | null },
	): Promise<CommentsResponse> {
		return api.patch<CommentsResponse>(`/comments/${id}`, body);
	},

	remove(id: string): Promise<CommentsResponse> {
		return api.delete<CommentsResponse>(`/comments/${id}`);
	},

	react(id: string, emoji: string): Promise<CommentsResponse> {
		return api.post<CommentsResponse>(`/comments/${id}/react`, { emoji });
	},
};

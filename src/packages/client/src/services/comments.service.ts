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

export const commentsService = {
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

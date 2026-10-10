import type { EntityRef } from '@mu/shared';
import { api } from './api';
import type { CommentsResponse } from './comments.service';

/**
 * Generic per-entity endpoints (ratings + comments) shared by movies and
 * music. Contract: docs/music-support-plan.md §4.2 / §6.2.
 */

export interface RatingSummary {
	avg: number | null;
	count: number;
	userRating: number | null;
}

function base(ref: EntityRef): string {
	return `/entities/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`;
}

export const entitiesService = {
	ratingSummary(ref: EntityRef): Promise<RatingSummary> {
		return api.get<RatingSummary>(`${base(ref)}/rating-summary`);
	},
	getRating(ref: EntityRef): Promise<{ rating: number | null }> {
		return api.get(`${base(ref)}/rating`);
	},
	setRating(ref: EntityRef, rating: number): Promise<unknown> {
		return api.put(`${base(ref)}/rating`, { rating });
	},
	clearRating(ref: EntityRef): Promise<unknown> {
		return api.delete(`${base(ref)}/rating`);
	},
	listComments(ref: EntityRef): Promise<CommentsResponse> {
		return api.get<CommentsResponse>(`${base(ref)}/comments`);
	},
	createComment(
		ref: EntityRef,
		body: { text: string; timeSeconds?: number | null; parentId?: string | null },
	): Promise<CommentsResponse> {
		return api.post<CommentsResponse>(`${base(ref)}/comments`, body);
	},
};

import type { Movie } from '@/state/library.state';
import { api } from './api';
import type { MatchCandidate } from './movies.service';

export type GroupRole = 'parent' | 'subgroup';
export type GroupStatus = 'auto' | 'unsure' | 'confirmed' | 'rejected';

export interface MovieGroup {
	id: string;
	type: GroupRole;
	groupType: string;
	name: string;
	parentGroupId: string | null;
	ordinal: number | null;
	tmdbTvId?: number | null;
	imdbId?: string | null;
	posterUrl?: string | null;
	backdropUrl?: string | null;
	overview?: string | null;
	status: GroupStatus;
	confidence: number | null;
	altParents?: string | null;
	detectionSource?: string | null;
	createdAt: string;
	updatedAt: string;
	/** Optional, populated by /groups list endpoint. */
	subgroupCount?: number;
	/** Total movie count across every subgroup under this parent. */
	totalMembers?: number;
	/** Latest `addedAt` across all members — drives library mixed-view sort. */
	latestMemberAddedAt?: string | null;
	/** Earliest member year — used for year-sort in the mixed view. */
	earliestYear?: number | null;
}

export interface AltParent {
	parentGroupId: string;
	confidence: number;
}

export interface GroupDetailResponse {
	group: MovieGroup;
	children: MovieGroup[];
	movies: Movie[];
	altParents: AltParent[];
}

export const groupsService = {
	listParents(): Promise<{ groups: MovieGroup[] }> {
		return api.get<{ groups: MovieGroup[] }>('/groups');
	},

	listUnsure(): Promise<{ groups: MovieGroup[] }> {
		return api.get<{ groups: MovieGroup[] }>('/groups/unsure');
	},

	get(id: string): Promise<GroupDetailResponse> {
		return api.get<GroupDetailResponse>(`/groups/${id}`);
	},

	listMovies(id: string): Promise<{ movies: Movie[] }> {
		return api.get<{ movies: Movie[] }>(`/groups/${id}/movies`);
	},

	confirm(id: string): Promise<{ ok: boolean }> {
		return api.post(`/groups/${id}/confirm`, {});
	},

	reject(id: string): Promise<{ ok: boolean }> {
		return api.post(`/groups/${id}/reject`, {});
	},

	patch(
		id: string,
		body: Partial<{
			name: string;
			groupType: string;
			posterUrl: string;
			backdropUrl: string;
			overview: string;
			parentGroupId: string | null;
		}>,
	): Promise<{ ok: boolean }> {
		return api.patch(`/groups/${id}`, body);
	},

	/**
	 * Kick off the grouping rebuild in the background. Returns
	 * immediately with the jobId + total-movie count; the caller
	 * subscribes to `JOB_PROGRESS` / `JOB_COMPLETED` on the existing
	 * WebSocket channel for live progress + the final summary.
	 */
	rebuild(): Promise<{
		ok: boolean;
		jobId: string;
		totalMovies: number;
		message: string;
	}> {
		return api.post('/groups/admin/rebuild', {});
	},

	listMatchCandidates(
		groupId: string,
	): Promise<{ candidates: MatchCandidate[] }> {
		return api.get(`/groups/${groupId}/match-candidates`);
	},

	applyMatchCandidate(
		groupId: string,
		provider: string,
		externalId: string,
	): Promise<unknown> {
		return api.post(`/groups/${groupId}/match-candidates/apply`, {
			provider,
			externalId,
		});
	},

	clearMatchCandidates(groupId: string): Promise<{ ok: boolean }> {
		return api.delete(`/groups/${groupId}/match-candidates`);
	},

	refreshMetadata(groupId: string): Promise<unknown> {
		return api.post(`/groups/${groupId}/refresh-metadata`, {});
	},
};

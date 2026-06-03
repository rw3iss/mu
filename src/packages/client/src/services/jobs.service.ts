import { api } from './api';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export interface Job {
	id: string;
	type: string;
	label: string;
	status: JobStatus;
	payload: Record<string, unknown>;
	priority: number;
	progress?: number;
	result?: unknown;
	error?: string;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
}

export const jobsService = {
	list(params?: { type?: string; status?: JobStatus }): Promise<Job[]> {
		const q: Record<string, string> = {};
		if (params?.type) q.type = params.type;
		if (params?.status) q.status = params.status;
		return api.get<Job[]>('/jobs', q);
	},

	get(id: string): Promise<Job> {
		return api.get<Job>(`/jobs/${id}`);
	},

	cancel(id: string): Promise<{ success: boolean }> {
		return api.post<{ success: boolean }>(`/jobs/${id}/cancel`);
	},

	prioritize(id: string): Promise<{ success: boolean }> {
		return api.post<{ success: boolean }>(`/admin/server/jobs/${id}/prioritize`);
	},

	pause(id: string): Promise<{ success: boolean }> {
		return api.post<{ success: boolean }>(`/admin/server/jobs/${id}/pause`);
	},

	resume(id: string): Promise<{ success: boolean }> {
		return api.post<{ success: boolean }>(`/admin/server/jobs/${id}/resume`);
	},

	retry(id: string): Promise<{ success: boolean; newJobId: string | null; reason?: string }> {
		return api.post<{ success: boolean; newJobId: string | null; reason?: string }>(
			`/admin/server/jobs/${id}/retry`,
		);
	},

	/** Active job (any type) for a movie + transcode status. Used to deep-link. */
	movieStatus(
		movieId: string,
	): Promise<{ running: boolean; progress?: number; pending: boolean; jobId: string | null }> {
		return api.get(`/jobs/movies/${encodeURIComponent(movieId)}/transcode-status`);
	},
};

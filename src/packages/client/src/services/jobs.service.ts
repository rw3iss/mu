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
};

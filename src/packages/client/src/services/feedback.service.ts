import { api } from './api';

export interface FeedbackSummary {
	id: string;
	name: string | null;
	email: string | null;
	description: string;
	pageUrl: string | null;
	status: string;
	hasScreenshot: boolean;
	screenshotName: string | null;
	/** On-disk attachment URL (`/uploads/feedback/…`) for new rows. */
	attachmentUrl: string | null;
	/** Attachment MIME type (e.g. `image/gif`, `video/mp4`). */
	attachmentType: string | null;
	createdAt: string;
}

export interface FeedbackDetail extends FeedbackSummary {
	userId: string | null;
	userAgent: string | null;
	/** Legacy `data:<mime>;base64,...` screenshot, when present (old rows). */
	screenshotData: string | null;
}

export interface SubmitFeedbackInput {
	name?: string;
	email?: string;
	description: string;
	pageUrl?: string;
	screenshot?: File | null;
}

export const feedbackService = {
	/** Submit feedback (any authenticated user). Uses multipart for the optional screenshot. */
	async submit(input: SubmitFeedbackInput): Promise<{ ok: boolean; id: string }> {
		const form = new FormData();
		form.append('description', input.description);
		if (input.name) form.append('name', input.name);
		if (input.email) form.append('email', input.email);
		form.append('pageUrl', input.pageUrl ?? window.location.href);
		if (input.screenshot) form.append('screenshot', input.screenshot);

		const token = localStorage.getItem('mu_token');
		const res = await fetch('/api/v1/feedback', {
			method: 'POST',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: form,
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}) as any);
			throw new Error((body as any).message || `Submit failed: ${res.status}`);
		}
		return res.json();
	},

	/** Admin: list all feedback (without screenshot payloads). */
	list(): Promise<{ feedback: FeedbackSummary[] }> {
		return api.get('/feedback');
	},

	/** Admin: full detail incl. screenshot data URL. */
	detail(id: string): Promise<{ feedback: FeedbackDetail }> {
		return api.get(`/feedback/${id}`);
	},

	/** Admin: update triage status. */
	setStatus(id: string, status: string): Promise<{ ok: boolean }> {
		return api.patch(`/feedback/${id}`, { status });
	},

	/**
	 * Admin: resolve and/or reply to a ticket, emailing the submitter.
	 * `resolve` toggles closing the ticket; `message` is the reply body
	 * (required when not resolving).
	 */
	respond(
		id: string,
		body: { resolve: boolean; message?: string },
	): Promise<{ ok: boolean; status: string; emailed: boolean; emailError?: string }> {
		return api.post(`/feedback/${id}/respond`, body);
	},

	/** Admin: delete one entry. */
	remove(id: string): Promise<{ ok: boolean }> {
		return api.delete(`/feedback/${id}`);
	},

	/** Admin: clear all feedback. */
	clear(): Promise<{ cleared: number }> {
		return api.delete('/feedback');
	},
};

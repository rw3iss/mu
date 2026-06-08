import type { MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import { api } from './api';

export const subtitlesService = {
	/** List existing subtitle tracks for a movie */
	list(movieId: string): Promise<{ subtitles: MovieSubtitleInfo[] }> {
		return api.get<{ subtitles: MovieSubtitleInfo[] }>(`/subtitles/${movieId}`);
	},

	/** Search third-party providers for subtitles */
	search(movieId: string, language?: string): Promise<{ results: SubtitleSearchResult[] }> {
		return api.post<{ results: SubtitleSearchResult[] }>(`/subtitles/${movieId}/search`, {
			language,
		});
	},

	/** Download a subtitle from a provider and save it to the movie */
	download(
		movieId: string,
		provider: string,
		fileId: string,
		language?: string,
		releaseName?: string,
	): Promise<{ subtitle: MovieSubtitleInfo }> {
		return api.post<{ subtitle: MovieSubtitleInfo }>(`/subtitles/${movieId}/download`, {
			provider,
			fileId,
			language,
			releaseName,
		});
	},

	/** Delete a subtitle track */
	remove(movieId: string, trackIndex: number): Promise<{ success: boolean }> {
		return api.delete<{ success: boolean }>(`/subtitles/${movieId}/${trackIndex}`);
	},

	/** Mark a track as the movie's default subtitle (persisted server-side). */
	setDefault(movieId: string, trackIndex: number): Promise<{ success: boolean }> {
		return api.put<{ success: boolean }>(`/subtitles/${movieId}/${trackIndex}/default`, {});
	},

	/** Admin: delete leftover downloaded subtitle files on movies with a default set. */
	cleanupUnused(): Promise<{ moviesTouched: number; filesRemoved: number }> {
		return api.post<{ moviesTouched: number; filesRemoved: number }>(
			'/subtitles/admin/cleanup-unused',
		);
	},

	/** Upload a subtitle file manually */
	async upload(movieId: string, file: File): Promise<{ subtitle: MovieSubtitleInfo }> {
		const formData = new FormData();
		formData.append('subtitle', file);

		const token = localStorage.getItem('mu_token');
		const response = await fetch(`/api/v1/subtitles/${movieId}/upload`, {
			method: 'POST',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: formData,
		});

		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new Error((body as any).message || `Upload failed: ${response.status}`);
		}

		return response.json();
	},
};

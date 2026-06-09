import { api } from './api';

export interface UploadTarget {
	id: string;
	path: string;
	label: string | null;
}

/** Resolve the API base the same way `api.ts` does (proxy default `/api/v1`). */
function apiBase(): string {
	return (
		(typeof import.meta.env?.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL) ||
		localStorage.getItem('mu_api_url') ||
		'/api/v1'
	);
}

export interface UploadFileOptions {
	sourceId: string;
	relativePath: string;
	file: File;
	onProgress?: (loaded: number, total: number) => void;
	signal?: AbortSignal;
}

export const libraryUploadService = {
	/** Enabled media-source destinations the user can upload into. */
	getTargets(): Promise<{ targets: UploadTarget[] }> {
		return api.get<{ targets: UploadTarget[] }>('/library/upload/targets');
	},

	/** Check top-level names (file or root folder) against the destination. */
	preflight(sourceId: string, names: string[]): Promise<{ conflicts: string[] }> {
		return api.post<{ conflicts: string[] }>('/library/upload/preflight', { sourceId, names });
	},

	/** Trigger a rescan of the destination after all files are uploaded. */
	finalize(sourceId: string, uploadId: string, rootName: string): Promise<{ ok: boolean }> {
		return api.post<{ ok: boolean }>('/library/upload/finalize', {
			sourceId,
			uploadId,
			rootName,
		});
	},

	/**
	 * Stream a single file to the server with upload progress. Uses XHR (fetch
	 * has no upload-progress events). Fields are appended before the file so the
	 * server sees sourceId/relativePath before the stream.
	 */
	uploadFile(opts: UploadFileOptions): Promise<{ ok: boolean; bytes: number }> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			const form = new FormData();
			form.append('sourceId', opts.sourceId);
			form.append('relativePath', opts.relativePath);
			form.append('file', opts.file, opts.file.name);

			xhr.open('POST', `${apiBase()}/library/upload`);
			const token = localStorage.getItem('mu_token');
			if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
			};
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						resolve(JSON.parse(xhr.responseText));
					} catch {
						resolve({ ok: true, bytes: opts.file.size });
					}
					return;
				}
				reject(new Error(parseError(xhr)));
			};
			xhr.onerror = () => reject(new Error('Network error during upload'));
			xhr.onabort = () => reject(new Error('Upload cancelled'));
			if (opts.signal) {
				opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
			}
			xhr.send(form);
		});
	},
};

function parseError(xhr: XMLHttpRequest): string {
	try {
		const body = JSON.parse(xhr.responseText) as { message?: unknown };
		const m = body?.message;
		if (typeof m === 'string' && m.trim()) return m;
		if (Array.isArray(m) && m.length) return m.filter(Boolean).join(', ');
	} catch {
		// fall through
	}
	return `Upload failed (HTTP ${xhr.status})`;
}

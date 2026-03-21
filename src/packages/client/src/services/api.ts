import { route } from 'preact-router';
import { currentUser } from '@/state/auth.state';

// ============================================
// Types
// ============================================

export class ApiError extends Error {
	constructor(
		public status: number,
		public statusText: string,
		public body: unknown,
	) {
		super(`API Error ${status}: ${statusText}`);
		this.name = 'ApiError';
	}
}

interface RequestOptions {
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

// ============================================
// Base API Client
// ============================================

/**
 * API base URL — configurable for standalone client builds.
 * Priority: VITE_API_URL env var > localStorage override > relative path (same-origin)
 *
 * For standalone builds: VITE_API_URL=https://your-server.com/api/v1 pnpm build
 * For runtime override: localStorage.setItem('mu_api_url', 'https://...')
 */
const BASE_URL =
	(typeof import.meta.env?.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL) ||
	localStorage.getItem('mu_api_url') ||
	'/api/v1';

function getAuthHeaders(): Record<string, string> {
	const token = localStorage.getItem('mu_token');
	if (token) {
		return { Authorization: `Bearer ${token}` };
	}
	return {};
}

function buildQueryString(params?: Record<string, string>): string {
	if (!params || Object.keys(params).length === 0) return '';
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== '') {
			searchParams.append(key, value);
		}
	}
	const qs = searchParams.toString();
	return qs ? `?${qs}` : '';
}

async function handleResponse<T>(response: Response): Promise<T> {
	if (response.status === 401) {
		localStorage.removeItem('mu_token');
		currentUser.value = null;
		route('/login', true);
		throw new ApiError(401, 'Unauthorized', null);
	}

	if (response.status === 204) {
		return undefined as unknown as T;
	}

	const contentType = response.headers.get('content-type');
	const isJson = contentType?.includes('application/json');

	if (!response.ok) {
		const body = isJson ? await response.json() : await response.text();
		throw new ApiError(response.status, response.statusText, body);
	}

	if (isJson) {
		return response.json() as Promise<T>;
	}

	return response.text() as unknown as T;
}

async function request<T>(
	method: string,
	path: string,
	body?: unknown,
	options?: RequestOptions,
): Promise<T> {
	const headers: Record<string, string> = {
		...getAuthHeaders(),
		...options?.headers,
	};

	if (body !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(`${BASE_URL}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
		signal: options?.signal,
	});

	return handleResponse<T>(response);
}

// ============================================
// Exported API Methods
// ============================================

export const api = {
	get<T>(path: string, params?: Record<string, string>, options?: RequestOptions): Promise<T> {
		return request<T>('GET', `${path}${buildQueryString(params)}`, undefined, options);
	},

	post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
		return request<T>('POST', path, body, options);
	},

	put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
		return request<T>('PUT', path, body, options);
	},

	patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
		return request<T>('PATCH', path, body, options);
	},

	delete<T>(path: string, options?: RequestOptions): Promise<T> {
		return request<T>('DELETE', path, undefined, options);
	},
};

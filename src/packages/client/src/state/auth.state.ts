import { computed, signal } from '@preact/signals';
import { route } from 'preact-router';
import { api } from '@/services/api';

// ============================================
// Types
// ============================================

export interface User {
	id: string;
	username: string;
	email: string;
	role: 'admin' | 'user';
	avatarUrl?: string;
	createdAt: string;
}

// ============================================
// Signals
// ============================================

export const currentUser = signal<User | null>(null);
export const isLoading = signal(true);
export const isSetupComplete = signal(true);
export const localBypass = signal(false);
export const isAuthenticated = computed(() => currentUser.value !== null);

// ============================================
// Actions
// ============================================

export async function login(username: string, password: string): Promise<void> {
	const response = await api.post<{ user: User; accessToken: string }>('/auth/login', {
		username,
		password,
	});

	localStorage.setItem('mu_token', response.accessToken);
	currentUser.value = response.user;
}

export async function logout(): Promise<void> {
	try {
		await api.post('/auth/logout');
	} catch {
		// Ignore logout errors
	} finally {
		localStorage.removeItem('mu_token');
		localStorage.removeItem('mu_player_state');
		localStorage.removeItem('mu_is_playing');
		currentUser.value = null;
		route('/login');
	}
}

export async function checkAuth(): Promise<void> {
	isLoading.value = true;

	try {
		// Check if setup is complete and whether local bypass is enabled
		const status = await api.get<{ setupComplete: boolean; localBypass?: boolean }>(
			'/auth/status',
		);
		isSetupComplete.value = status.setupComplete;
		localBypass.value = status.localBypass === true;

		if (!isSetupComplete.value) {
			isLoading.value = false;
			return;
		}

		// When local bypass is enabled, the server auto-authenticates localhost
		// requests — call /auth/me directly even without a token
		if (localBypass.value) {
			try {
				const user = await api.get<User>('/auth/me');
				currentUser.value = user;
			} catch {
				// Local bypass failed (e.g. no admin user yet) — treat as unauthenticated
				currentUser.value = null;
			}
			isLoading.value = false;
			return;
		}

		// Check if user has a stored token
		const token = localStorage.getItem('mu_token');
		if (!token) {
			isLoading.value = false;
			return;
		}

		const user = await api.get<User>('/auth/me');
		currentUser.value = user;
	} catch {
		currentUser.value = null;
		localStorage.removeItem('mu_token');
	} finally {
		isLoading.value = false;
	}
}

export async function setup(
	username: string,
	email: string | undefined,
	password: string,
	mediaPaths?: string[],
): Promise<void> {
	const body: Record<string, unknown> = { username, password };
	if (email) body.email = email;
	if (mediaPaths?.length) body.mediaPaths = mediaPaths;

	const response = await api.post<{ user: User; accessToken: string }>('/auth/setup', body);

	if (response.accessToken) {
		localStorage.setItem('mu_token', response.accessToken);
	}
	currentUser.value = response.user ?? (response as any);
	isSetupComplete.value = true;
}

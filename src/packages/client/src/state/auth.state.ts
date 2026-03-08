import { signal, computed } from '@preact/signals';
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
    currentUser.value = null;
  }
}

export async function checkAuth(): Promise<void> {
  isLoading.value = true;

  try {
    // Check if setup is complete
    const setupStatus = await api.get<{ setupComplete: boolean }>('/auth/status');
    isSetupComplete.value = setupStatus.setupComplete;

    if (!isSetupComplete.value) {
      isLoading.value = false;
      return;
    }

    // Check if user is authenticated
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

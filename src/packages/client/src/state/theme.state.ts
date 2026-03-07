import { signal, effect } from '@preact/signals';

// ============================================
// Types
// ============================================

export type Theme = 'dark' | 'light' | 'auto';

// ============================================
// Signals
// ============================================

export const theme = signal<Theme>('dark');

// ============================================
// Effects
// ============================================

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(t: Theme): void {
  const resolved = t === 'auto' ? getSystemTheme() : t;
  document.documentElement.setAttribute('data-theme', resolved);
}

effect(() => {
  applyTheme(theme.value);
  localStorage.setItem('mu_theme', theme.value);
});

// ============================================
// Actions
// ============================================

export function setTheme(newTheme: Theme): void {
  theme.value = newTheme;
}

export function toggleTheme(): void {
  if (theme.value === 'dark') {
    theme.value = 'light';
  } else if (theme.value === 'light') {
    theme.value = 'auto';
  } else {
    theme.value = 'dark';
  }
}

export function initTheme(): void {
  const saved = localStorage.getItem('mu_theme') as Theme | null;
  if (saved === 'dark' || saved === 'light' || saved === 'auto') {
    theme.value = saved;
  }

  // Listen for system theme changes
  if (typeof window !== 'undefined') {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (theme.value === 'auto') {
          applyTheme('auto');
        }
      });
  }
}

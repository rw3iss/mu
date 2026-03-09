import { signal, effect } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';

// ============================================
// Types
// ============================================

export type Theme = 'dark' | 'light' | 'auto';

// ============================================
// Signals
// ============================================

// Read saved theme from localStorage immediately (not in useEffect)
// so the effect below doesn't overwrite a saved value with the default.
const saved = getUiSetting<string>('theme', 'dark');
const initial: Theme = saved === 'dark' || saved === 'light' || saved === 'auto' ? saved : 'dark';

export const theme = signal<Theme>(initial);

// ============================================
// Effects
// ============================================

function getSystemTheme(): 'dark' | 'light' {
	if (typeof window === 'undefined') return 'dark';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(t: Theme): void {
	const resolved = t === 'auto' ? getSystemTheme() : t;
	document.documentElement.setAttribute('data-theme', resolved);
}

effect(() => {
	applyTheme(theme.value);
	setUiSetting('theme', theme.value);
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
	// Theme is already loaded from localStorage at module level.
	// Just set up the system-preference listener for 'auto' mode.
	if (typeof window !== 'undefined') {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (theme.value === 'auto') {
				applyTheme('auto');
			}
		});
	}
}

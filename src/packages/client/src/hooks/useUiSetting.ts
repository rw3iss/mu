import { type Signal, signal } from '@preact/signals';

/**
 * Persistent UI settings backed by localStorage.
 *
 * Usage:
 *   const [theme, setTheme] = useUiSetting('theme', 'dark');
 *   const [volume, setVolume] = useUiSetting('player.volume', 1);
 *
 * All keys are stored under the `mu_ui_` prefix in localStorage.
 * Values are JSON-serialized, so strings, numbers, booleans, and
 * plain objects all work.
 *
 * Each unique key gets a shared Preact signal under the hood, so
 * multiple components reading the same key stay in sync reactively.
 */

const PREFIX = 'mu_ui_';

// Shared signal cache — one signal per key across the entire app
const signalCache = new Map<string, Signal<any>>();

function getStoredValue<T>(key: string, defaultValue: T): T {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		if (raw === null) return defaultValue;
		return JSON.parse(raw) as T;
	} catch {
		return defaultValue;
	}
}

function getOrCreateSignal<T>(key: string, defaultValue: T): Signal<T> {
	const existing = signalCache.get(key);
	if (existing) return existing;

	const initial = getStoredValue(key, defaultValue);
	const s = signal<T>(initial);
	signalCache.set(key, s);
	return s;
}

export function useUiSetting<T>(key: string, defaultValue: T): [T, (value: T) => void] {
	const s = getOrCreateSignal(key, defaultValue);

	const setValue = (value: T) => {
		s.value = value;
		try {
			localStorage.setItem(PREFIX + key, JSON.stringify(value));
		} catch {
			// Storage full or unavailable — ignore
		}
	};

	return [s.value, setValue];
}

/**
 * Standalone getter/setter for use outside of components (e.g. in state modules).
 * Same shared signals and localStorage backing as the hook.
 */
export function getUiSetting<T>(key: string, defaultValue: T): T {
	return getOrCreateSignal(key, defaultValue).value;
}

export function setUiSetting<T>(key: string, value: T): void {
	const s = getOrCreateSignal(key, value);
	s.value = value;
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		// ignore
	}
}

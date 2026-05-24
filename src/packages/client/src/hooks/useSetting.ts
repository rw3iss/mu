import { useComputed } from '@preact/signals';
import { clearMine, setMine, userSettings } from '@/state/userSettings.state';

/**
 * Read a per-user setting with a typed fallback. The returned tuple
 * mirrors `useState` semantics so callers can do:
 *
 *   const [autoplay, setAutoplay] = useSetting('playback.autoplay', true);
 *
 * Writes optimistically update the shared signal and persist to
 * `PUT /settings/me/:key`. Use `clearSetting` to drop a key and revert
 * to the app default.
 */
export function useSetting<T>(key: string, defaultValue: T) {
	const value = useComputed<T>(() => {
		const raw = userSettings.value[key];
		return raw === undefined || raw === null ? defaultValue : (raw as T);
	});

	const setValue = (next: T) => setMine(key, next);
	const clearValue = () => clearMine(key);

	return [value.value, setValue, clearValue] as const;
}

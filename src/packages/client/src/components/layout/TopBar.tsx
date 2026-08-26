import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { currentPath, currentUrl } from '@/app';
import { Icon } from '@/components/common/Icon';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useDebounce } from '@/hooks/useDebounce';
// The back-stack lives in library.state so the Library page's own back arrow
// (next to its title) can consume it; the header input only maintains it.
import { navToLibrary, searchBackStack, searchMovies } from '@/state/library.state';
import { theme, toggleTheme } from '@/state/theme.state';
import { type Throttled, throttle } from '@/utils/throttle';

import styles from './TopBar.module.scss';

/**
 * Two queries are "related" when one is a prefix of the other — i.e. the user
 * is refining the same search (typing more / deleting), not starting a new one.
 * Used so the back stack records distinct searches, not every keystroke.
 */
function related(a: string, b: string): boolean {
	return a.startsWith(b) || b.startsWith(a);
}

export function TopBar() {
	const [searchValue, setSearchValue] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	// Auto-search throttle (leading + trailing, 100ms) — created once.
	const throttledNavRef = useRef<Throttled<[string]> | null>(null);
	if (!throttledNavRef.current) throttledNavRef.current = throttle(navToLibrary, 100);

	// Back-stack bookkeeping: record settled searches without polluting on every
	// keystroke. `skipSettle` suppresses the next record for programmatic changes
	// (back/clear/url-sync) so they don't re-push.
	const lastSettledRef = useRef('');
	const skipSettleRef = useRef(false);
	const settled = useDebounce(searchValue.trim(), 450);

	// Sync the input from the URL ?q= when on /library and not actively typing
	// (browser back/forward, deep links, the page's own URL updates).
	useEffect(() => {
		if (currentPath.value !== '/library') return;
		if (document.activeElement === inputRef.current) return;
		const q = new URLSearchParams(window.location.search).get('q') || '';
		if (q !== searchValue) {
			skipSettleRef.current = true;
			lastSettledRef.current = q.trim();
			setSearchValue(q);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on URL only
	}, [currentUrl.value]);

	// Push the previous settled query onto the back stack when a genuinely
	// different (non-prefix) search settles. Empty value resets the stack.
	useEffect(() => {
		if (skipSettleRef.current) {
			skipSettleRef.current = false;
			lastSettledRef.current = settled;
			return;
		}
		const prev = lastSettledRef.current;
		if (settled === prev) return;
		if (settled === '') {
			searchBackStack.value = [];
			lastSettledRef.current = '';
			return;
		}
		if (prev && !related(prev, settled)) {
			const s = searchBackStack.value;
			if (s[s.length - 1] !== prev) searchBackStack.value = [...s, prev];
		}
		lastSettledRef.current = settled;
	}, [settled]);

	const handleInput = useCallback((e: Event) => {
		const v = (e.target as HTMLInputElement).value;
		setSearchValue(v);
		throttledNavRef.current?.(v);
	}, []);

	/**
	 * Re-run a search for `value`. When we're already on /library showing this
	 * exact query, `navToLibrary` would no-op (URL unchanged) and nothing would
	 * refresh — so we re-fetch directly, which picks up movies added since the
	 * last search. Otherwise normal URL navigation drives the fetch.
	 */
	const forceSearch = useCallback((value: string) => {
		const trimmed = value.trim();
		throttledNavRef.current?.cancel();
		const onLibrary = currentPath.value === '/library';
		const urlQ = (new URLSearchParams(window.location.search).get('q') || '').trim();
		if (onLibrary && trimmed === urlQ) {
			searchMovies(trimmed);
		} else {
			navToLibrary(trimmed);
		}
	}, []);

	// Enter re-searches even when the text is unchanged.
	const handleSubmit = useCallback(
		(e: Event) => {
			e.preventDefault();
			forceSearch(searchValue);
			inputRef.current?.blur();
		},
		[forceSearch, searchValue],
	);

	// Re-entering the input re-runs the existing search (so it catches newly
	// added movies), and selects the text for easy replacement.
	const handleFocus = useCallback(
		(e: Event) => {
			const el = e.target as HTMLInputElement;
			el.select();
			if (el.value.trim()) forceSearch(el.value);
		},
		[forceSearch],
	);

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		// Escape blurs the search input (drops keyboard focus).
		if (e.key === 'Escape') {
			e.preventDefault();
			inputRef.current?.blur();
		}
	}, []);

	const handleClear = useCallback(() => {
		throttledNavRef.current?.cancel();
		skipSettleRef.current = true;
		lastSettledRef.current = '';
		searchBackStack.value = [];
		setSearchValue('');
		navToLibrary('');
	}, []);

	const themeLabel = theme.value === 'dark' ? 'Dark' : theme.value === 'light' ? 'Light' : 'Auto';

	return (
		<header class={styles.topbar}>
			<form class={styles.searchForm} onSubmit={handleSubmit}>
				<input
					ref={inputRef}
					type="text"
					class={styles.searchInput}
					placeholder="Search movies..."
					value={searchValue}
					onInput={handleInput}
					onKeyDown={handleKeyDown}
					onFocus={handleFocus}
					aria-label="Search movies"
					title={
						'Search movies. Use "quotes" to match a whole word — "Her" won\'t match Hero.'
					}
				/>
				{searchValue && (
					<button
						type="button"
						class={styles.searchClear}
						onClick={handleClear}
						aria-label="Clear search"
						title="Clear search"
					>
						<Icon name="x" size={14} />
					</button>
				)}
			</form>

			<div class={styles.actions}>
				<NotificationBell />
				<button
					class={styles.themeToggle}
					onClick={toggleTheme}
					title={`Theme: ${themeLabel}`}
					aria-label={`Toggle theme (currently ${themeLabel})`}
				>
					<Icon
						name={
							theme.value === 'dark'
								? 'moon'
								: theme.value === 'light'
									? 'sun'
									: 'monitor'
						}
					/>
				</button>
			</div>
		</header>
	);
}

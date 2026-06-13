import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { currentPath, currentUrl } from '@/app';
import { Icon } from '@/components/common/Icon';
import { useDebounce } from '@/hooks/useDebounce';
// The back-stack lives in library.state so the Library page's own back arrow
// (next to its title) can consume it; the header input only maintains it.
import { navToLibrary, searchBackStack } from '@/state/library.state';
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

	const handleSubmit = useCallback(
		(e: Event) => {
			e.preventDefault();
			throttledNavRef.current?.cancel();
			navToLibrary(searchValue);
			inputRef.current?.blur();
		},
		[searchValue],
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
				<span class={styles.searchIcon}>
					<svg
						width={18}
						height={18}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width={2}
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="11" cy="11" r="8" />
						<line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
				</span>
				<input
					ref={inputRef}
					type="text"
					class={styles.searchInput}
					placeholder="Search movies..."
					value={searchValue}
					onInput={handleInput}
					onKeyDown={handleKeyDown}
					onFocus={(e) => (e.target as HTMLInputElement).select()}
					aria-label="Search movies"
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

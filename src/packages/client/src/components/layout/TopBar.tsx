import { useCallback, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import { theme, toggleTheme } from '@/state/theme.state';

import styles from './TopBar.module.scss';

export function TopBar() {
	const [searchValue, setSearchValue] = useState('');

	const goToLibrary = useCallback((value: string) => {
		const trimmed = value.trim();
		const target = trimmed ? `/library?q=${encodeURIComponent(trimmed)}` : '/library';
		const current = window.location.pathname + window.location.search;
		if (current !== target) {
			route(target);
		}
	}, []);

	const handleSearch = useCallback((e: Event) => {
		const target = e.target as HTMLInputElement;
		setSearchValue(target.value);
	}, []);

	const handleSearchSubmit = useCallback(
		(e: Event) => {
			e.preventDefault();
			goToLibrary(searchValue);
		},
		[searchValue, goToLibrary],
	);

	const handleSearchBlur = useCallback(() => {
		// Always sync the URL on blur. When the input is empty, we still
		// need to drop any existing ?q= the user just wiped out —
		// otherwise the Library page stays stuck on the old filter.
		goToLibrary(searchValue);
	}, [searchValue, goToLibrary]);

	const handleSearchClear = useCallback(() => {
		setSearchValue('');
		// Clearing should drop ?q= and refetch the unfiltered library
		// immediately — don't wait for blur.
		goToLibrary('');
	}, [goToLibrary]);

	const themeLabel = theme.value === 'dark' ? 'Dark' : theme.value === 'light' ? 'Light' : 'Auto';

	return (
		<header class={styles.topbar}>
			<form class={styles.searchForm} onSubmit={handleSearchSubmit}>
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
					type="text"
					class={styles.searchInput}
					placeholder="Search movies..."
					value={searchValue}
					onInput={handleSearch}
					onBlur={handleSearchBlur}
					aria-label="Search movies"
				/>
				{searchValue && (
					<button
						type="button"
						class={styles.searchClear}
						onClick={handleSearchClear}
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

import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { theme, toggleTheme } from '@/state/theme.state';
import { useDebounce } from '@/hooks/useDebounce';
import styles from './TopBar.module.scss';

export function TopBar() {
  const [searchValue, setSearchValue] = useState('');
  const debouncedSearch = useDebounce(searchValue, 300);

  useEffect(() => {
    if (debouncedSearch) {
      route(`/search?q=${encodeURIComponent(debouncedSearch)}`);
    }
  }, [debouncedSearch]);

  const handleSearch = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    setSearchValue(target.value);
  }, []);

  const handleSearchSubmit = useCallback(
    (e: Event) => {
      e.preventDefault();
      if (searchValue.trim()) {
        route(`/search?q=${encodeURIComponent(searchValue.trim())}`);
      }
    },
    [searchValue]
  );

  const themeLabel =
    theme.value === 'dark' ? 'Dark' : theme.value === 'light' ? 'Light' : 'Auto';

  return (
    <header class={styles.topbar}>
      <form class={styles.searchForm} onSubmit={handleSearchSubmit}>
        <span class={styles.searchIcon}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          class={styles.searchInput}
          placeholder="Search movies..."
          value={searchValue}
          onInput={handleSearch}
          aria-label="Search movies"
        />
      </form>

      <div class={styles.actions}>
        <button
          class={styles.themeToggle}
          onClick={toggleTheme}
          title={`Theme: ${themeLabel}`}
          aria-label={`Toggle theme (currently ${themeLabel})`}
        >
          {theme.value === 'dark' ? '\u{1F319}' : theme.value === 'light' ? '\u2600' : '\u{1F500}'}
        </button>
      </div>
    </header>
  );
}

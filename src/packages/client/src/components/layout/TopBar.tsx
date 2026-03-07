import { h } from 'preact';
import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { currentUser, logout } from '@/state/auth.state';
import { theme, toggleTheme } from '@/state/theme.state';
import { useDebounce } from '@/hooks/useDebounce';
import styles from './TopBar.module.scss';

export function TopBar() {
  const [searchValue, setSearchValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const debouncedSearch = useDebounce(searchValue, 300);
  const user = currentUser.value;

  useEffect(() => {
    if (debouncedSearch) {
      route(`/search?q=${encodeURIComponent(debouncedSearch)}`);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

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

  const handleLogout = useCallback(async () => {
    setMenuOpen(false);
    await logout();
    route('/login');
  }, []);

  const themeLabel =
    theme.value === 'dark' ? 'Dark' : theme.value === 'light' ? 'Light' : 'Auto';

  return (
    <header class={styles.topbar}>
      <form class={styles.searchForm} onSubmit={handleSearchSubmit}>
        <span class={styles.searchIcon}>{'\u{1F50D}'}</span>
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

        {user && (
          <div class={styles.userMenu} ref={menuRef}>
            <button
              class={styles.userButton}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              <div class={styles.avatar}>
                {user.username.charAt(0).toUpperCase()}
              </div>
            </button>

            {menuOpen && (
              <div class={styles.dropdown}>
                <div class={styles.dropdownHeader}>
                  <span class={styles.dropdownName}>{user.username}</span>
                  <span class={styles.dropdownEmail}>{user.email}</span>
                </div>
                <div class={styles.dropdownDivider} />
                <button
                  class={styles.dropdownItem}
                  onClick={() => {
                    setMenuOpen(false);
                    route('/settings');
                  }}
                >
                  Settings
                </button>
                {user.role === 'admin' && (
                  <button
                    class={styles.dropdownItem}
                    onClick={() => {
                      setMenuOpen(false);
                      route('/admin');
                    }}
                  >
                    Admin
                  </button>
                )}
                <div class={styles.dropdownDivider} />
                <button class={`${styles.dropdownItem} ${styles.danger}`} onClick={handleLogout}>
                  Logout
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

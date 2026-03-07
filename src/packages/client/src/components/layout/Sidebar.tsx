import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { currentUser } from '@/state/auth.state';
import { currentPath } from '@/app';
import styles from './Sidebar.module.scss';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: '\u2302' },
  { label: 'Library', path: '/library', icon: '\u{1F3AC}' },
  { label: 'Discover', path: '/discover', icon: '\u2728' },
  { label: 'Playlists', path: '/playlists', icon: '\u{1F4CB}' },
  { label: 'Watchlist', path: '/watchlist', icon: '\u2606' },
  { label: 'History', path: '/history', icon: '\u23F1' },
  { label: 'Settings', path: '/settings', icon: '\u2699' },
  { label: 'Plugins', path: '/plugins', icon: '\u{1F9E9}', adminOnly: true },
  { label: 'Admin', path: '/admin', icon: '\u{1F6E1}', adminOnly: true },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const user = currentUser.value;
  const activePath = currentPath.value;

  const handleNav = useCallback((path: string) => {
    route(path);
  }, []);

  const filteredItems = navItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  );

  return (
    <nav class={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div class={styles.header}>
        <button class={styles.logo} onClick={() => handleNav('/')}>
          <span class={styles.logoIcon}>M</span>
          {!collapsed && <span class={styles.logoText}>Mu</span>}
        </button>
        <button
          class={styles.toggle}
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '\u276F' : '\u276E'}
        </button>
      </div>

      <ul class={styles.nav}>
        {filteredItems.map((item) => (
          <li key={item.path}>
            <button
              class={`${styles.navItem} ${activePath === item.path ? styles.active : ''}`}
              onClick={() => handleNav(item.path)}
              title={collapsed ? item.label : undefined}
            >
              <span class={styles.navIcon}>{item.icon}</span>
              {!collapsed && <span class={styles.navLabel}>{item.label}</span>}
            </button>
          </li>
        ))}
      </ul>

      {user && !collapsed && (
        <div class={styles.userInfo}>
          <div class={styles.avatar}>
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div class={styles.userDetails}>
            <span class={styles.userName}>{user.username}</span>
            <span class={styles.userRole}>{user.role}</span>
          </div>
        </div>
      )}
    </nav>
  );
}

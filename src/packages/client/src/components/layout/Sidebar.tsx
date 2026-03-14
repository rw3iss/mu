import { JSX } from 'preact';
import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { currentPath } from '@/app';
import { currentUser, logout } from '@/state/auth.state';
import { isPlayerActive, playerMode } from '@/state/globalPlayer.state';
import { RecentlyPlayed } from './RecentlyPlayed';
import styles from './Sidebar.module.scss';

interface SidebarProps {
	collapsed: boolean;
	onToggle: () => void;
}

// Minimal SVG line icons — 20x20, stroke-based, no fill
function Icon({
	d,
	size = 20,
	stroke = 1.5,
}: {
	d: string;
	size?: number;
	stroke?: number;
}): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d={d} />
		</svg>
	);
}

// Two-path icon for cases needing multiple paths
function Icon2({
	d1,
	d2,
	size = 20,
	stroke = 1.5,
}: {
	d1: string;
	d2: string;
	size?: number;
	stroke?: number;
}): JSX.Element {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d={d1} />
			<path d={d2} />
		</svg>
	);
}

interface NavItem {
	label: string;
	path: string;
	icon: JSX.Element;
	adminOnly?: boolean;
}

const navItems: NavItem[] = [
	{
		label: 'Dashboard',
		path: '/',
		icon: <Icon2 d1="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />,
	},
	{
		label: 'Library',
		path: '/library',
		icon: (
			<Icon2
				d1="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
				d2="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
			/>
		),
	},
	{
		label: 'Discover',
		path: '/discover',
		icon: (
			<Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
		),
	},
	{
		label: 'Playlists',
		path: '/playlists',
		icon: <Icon2 d1="M8 6h13M8 12h13M8 18h13" d2="M3 6h.01M3 12h.01M3 18h.01" />,
	},
	{
		label: 'Watchlist',
		path: '/watchlist',
		icon: <Icon d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
	},
	{
		label: 'History',
		path: '/history',
		icon: (
			<svg
				width={20}
				height={20}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width={1.5}
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
		),
	},
	{
		label: 'Settings',
		path: '/settings',
		icon: (
			<svg
				width={20}
				height={20}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width={1.5}
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="12" r="3" />
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
			</svg>
		),
	},
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
	const user = currentUser.value;
	const activePath = currentPath.value;
	const showMiniPlayer = isPlayerActive.value && playerMode.value === 'mini';

	const handleNav = useCallback((path: string) => {
		route(path);
	}, []);

	const filteredItems = navItems.filter((item) => !item.adminOnly || user?.role === 'admin');

	return (
		<nav
			class={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${showMiniPlayer ? styles.withMiniPlayer : ''}`}
		>
			<div class={styles.header}>
				<button class={styles.logo} onClick={() => handleNav('/')}>
					<img src="/mu_logo_128w.png" alt="Mu" class={styles.logoImage} />
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
							class={`${styles.navItem} ${activePath === item.path || (item.path !== '/' && activePath.startsWith(item.path)) ? styles.active : ''}`}
							onClick={() => handleNav(item.path)}
							title={collapsed ? item.label : undefined}
						>
							<span class={styles.navIcon}>{item.icon}</span>
							{!collapsed && <span class={styles.navLabel}>{item.label}</span>}
						</button>
					</li>
				))}
			</ul>

			{!collapsed && <RecentlyPlayed />}

			{user && !collapsed && (
				<div class={styles.userInfo}>
					<div class={styles.avatar}>{user.username.charAt(0).toUpperCase()}</div>
					<div class={styles.userDetails}>
						<span class={styles.userName}>{user.username}</span>
						<span class={styles.userRole}>{user.role}</span>
					</div>
					<button
						class={styles.logoutButton}
						onClick={logout}
						title="Logout"
						aria-label="Logout"
					>
						<Icon2
							d1="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
							d2="M16 17l5-5-5-5M21 12H9"
							size={18}
						/>
					</button>
				</div>
			)}
		</nav>
	);
}

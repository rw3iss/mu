import { resolveDisplayName } from '@mu/shared';
import { JSX } from 'preact';
import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { currentPath } from '@/app';
import { Link } from '@/components/common/Link';
import { currentUser, logout } from '@/state/auth.state';
import { openFeedbackModal } from '@/state/feedback.state';
import { isPlayerActive, playerMode } from '@/state/globalPlayer.state';
import { showUsersInfo } from '@/state/system.state';
import { fetchMovies } from '@/state/library.state';
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
	/** Only shown when the admin "Show Users Info" system setting is enabled. */
	requiresUsersInfo?: boolean;
	/** When set, the item runs this instead of navigating (e.g. open a modal). */
	action?: () => void;
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
		label: 'Favorites',
		path: '/favorites',
		icon: (
			<Icon d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z" />
		),
	},
	{
		label: 'Members',
		path: '/members',
		requiresUsersInfo: true,
		icon: (
			<Icon2
				d1="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
				d2="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
			/>
		),
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
		label: 'Feedback',
		path: '#feedback',
		icon: (
			<Icon d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
		),
		action: openFeedbackModal,
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
		if (path === '/library') {
			// Clear saved scroll/page so clicking Library starts fresh at page 1
			sessionStorage.removeItem('mu_library_scroll');
			// If already on the library page, force reset to page 1
			if (window.location.pathname === '/library') {
				fetchMovies(1);
				window.scrollTo({ top: 0, behavior: 'smooth' });
				// Clear page param from URL
				window.history.replaceState(null, '', '/library');
				return;
			}
		}
		route(path);
	}, []);

	const filteredItems = navItems.filter(
		(item) =>
			(!item.adminOnly || user?.role === 'admin') &&
			(!item.requiresUsersInfo || showUsersInfo.value),
	);

	return (
		<nav
			class={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${showMiniPlayer ? styles.withMiniPlayer : ''}`}
		>
			<div class={styles.header}>
				<Link href="/" onNavigate={() => handleNav('/')} class={styles.logo}>
					<img src="/mu_logo_small.png" alt="Mu" class={styles.logoImage} />
				</Link>
				<button
					class={styles.toggle}
					onClick={onToggle}
					aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					<Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
				</button>
			</div>

			<ul class={styles.nav}>
				{filteredItems.map((item) => {
					const navClass = `${styles.navItem} ${activePath === item.path || (item.path !== '/' && !item.action && activePath.startsWith(item.path)) ? styles.active : ''}`;
					const inner = (
						<>
							<span class={styles.navIcon}>{item.icon}</span>
							{!collapsed && <span class={styles.navLabel}>{item.label}</span>}
						</>
					);
					return (
						<li key={item.path}>
							{item.action ? (
								<button
									class={navClass}
									onClick={item.action}
									title={collapsed ? item.label : undefined}
								>
									{inner}
								</button>
							) : (
								<Link
									href={item.path}
									onNavigate={() => handleNav(item.path)}
									class={navClass}
									title={collapsed ? item.label : undefined}
								>
									{inner}
								</Link>
							)}
						</li>
					);
				})}
			</ul>

			{!collapsed && <RecentlyPlayed />}

			{user && !collapsed && (
				<div class={styles.userInfo}>
					<Link
						href="/profile"
						onNavigate={() => handleNav('/profile')}
						class={styles.userLink}
						title="Your profile"
					>
						<div class={styles.avatar}>
							{resolveDisplayName(user).charAt(0).toUpperCase()}
						</div>
						<div class={styles.userDetails}>
							<span class={styles.userName}>{resolveDisplayName(user)}</span>
							<span class={styles.userRole}>{user.role}</span>
						</div>
					</Link>
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

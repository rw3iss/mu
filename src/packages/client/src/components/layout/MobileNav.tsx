import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { currentPath } from '@/app';
import { Icon, type IconName } from '@/components/common/Icon';
import styles from './MobileNav.module.scss';

interface NavTab {
	label: string;
	path: string;
	icon: IconName;
}

const tabs: NavTab[] = [
	{ label: 'Home', path: '/', icon: 'home' },
	{ label: 'Library', path: '/library', icon: 'film' },
	{ label: 'Search', path: '/search', icon: 'search' },
	{ label: 'Playlists', path: '/playlists', icon: 'list-plus' },
	{ label: 'Profile', path: '/settings', icon: 'settings' },
];

export function MobileNav() {
	const activePath = currentPath.value;

	const handleNav = useCallback((path: string) => {
		route(path);
	}, []);

	return (
		<nav class={styles.mobileNav} aria-label="Mobile navigation">
			{tabs.map((tab) => (
				<button
					key={tab.path}
					class={`${styles.tab} ${activePath === tab.path ? styles.active : ''}`}
					onClick={() => handleNav(tab.path)}
					aria-label={tab.label}
					aria-current={activePath === tab.path ? 'page' : undefined}
				>
					<span class={styles.icon}>
						<Icon name={tab.icon} />
					</span>
					<span class={styles.label}>{tab.label}</span>
				</button>
			))}
		</nav>
	);
}

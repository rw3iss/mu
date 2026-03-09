import { useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { currentPath } from '@/app';
import styles from './MobileNav.module.scss';

interface NavTab {
	label: string;
	path: string;
	icon: string;
}

const tabs: NavTab[] = [
	{ label: 'Home', path: '/', icon: '\u2302' },
	{ label: 'Library', path: '/library', icon: '\uD83C\uDFAC' },
	{ label: 'Search', path: '/search', icon: '\uD83D\uDD0D' },
	{ label: 'Playlists', path: '/playlists', icon: '\uD83D\uDCCB' },
	{ label: 'Profile', path: '/settings', icon: '\u2699' },
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
					<span class={styles.icon}>{tab.icon}</span>
					<span class={styles.label}>{tab.label}</span>
				</button>
			))}
		</nav>
	);
}

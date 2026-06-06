import { currentPath } from '@/app';
import { Icon, type IconName } from '@/components/common/Icon';
import { Link } from '@/components/common/Link';
import styles from './MobileNav.module.scss';

interface NavTab {
	label: string;
	path: string;
	icon: IconName;
}

const tabs: NavTab[] = [
	{ label: 'Home', path: '/', icon: 'home' },
	{ label: 'Library', path: '/library', icon: 'film' },
	{ label: 'Playlists', path: '/playlists', icon: 'list-plus' },
	{ label: 'Profile', path: '/settings', icon: 'settings' },
];

export function MobileNav() {
	const activePath = currentPath.value;

	return (
		<nav class={styles.mobileNav} aria-label="Mobile navigation">
			{tabs.map((tab) => (
				<Link
					key={tab.path}
					href={tab.path}
					class={`${styles.tab} ${activePath === tab.path ? styles.active : ''}`}
					aria-label={tab.label}
					aria-current={activePath === tab.path ? 'page' : undefined}
				>
					<span class={styles.icon}>
						<Icon name={tab.icon} />
					</span>
					<span class={styles.label}>{tab.label}</span>
				</Link>
			))}
		</nav>
	);
}

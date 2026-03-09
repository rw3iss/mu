import { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';
import { isPlayerActive, playerMode } from '@/state/globalPlayer.state';
import styles from './AppShell.module.scss';

export const sidebarCollapsed = signal(false);

interface AppShellProps {
	children: ComponentChildren;
}

export function AppShell({ children }: AppShellProps) {
	const collapsed = sidebarCollapsed.value;
	const showMiniPlayer = isPlayerActive.value && playerMode.value === 'mini';

	return (
		<div
			class={`${styles.shell} ${collapsed ? styles.collapsed : ''} ${showMiniPlayer ? styles.withMiniPlayer : ''}`}
		>
			<Sidebar collapsed={collapsed} onToggle={() => (sidebarCollapsed.value = !collapsed)} />
			<div class={styles.main}>
				<TopBar />
				<main class={styles.content}>{children}</main>
			</div>
			<MobileNav />
		</div>
	);
}

import { signal } from '@preact/signals';
import { ComponentChildren } from 'preact';
import { isPlayerActive, playerMode, splitWidth } from '@/state/globalPlayer.state';
import styles from './AppShell.module.scss';
import { EncoderHealthBanner } from './EncoderHealthBanner';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export const sidebarCollapsed = signal(false);

interface AppShellProps {
	children: ComponentChildren;
}

export function AppShell({ children }: AppShellProps) {
	const collapsed = sidebarCollapsed.value;
	const showMiniPlayer = isPlayerActive.value && playerMode.value === 'mini';
	const showSplitPlayer = isPlayerActive.value && playerMode.value === 'split';

	return (
		<div
			class={`${styles.shell} ${collapsed ? styles.collapsed : ''} ${showMiniPlayer ? styles.withMiniPlayer : ''} ${showSplitPlayer ? styles.withSplitPlayer : ''}`}
			style={
				showSplitPlayer ? { maxWidth: `calc(100vw - ${splitWidth.value}vw)` } : undefined
			}
		>
			<Sidebar collapsed={collapsed} onToggle={() => (sidebarCollapsed.value = !collapsed)} />
			<div class={styles.main}>
				<TopBar />
				<main class={styles.content}>{children}</main>
			</div>
			<MobileNav />
			<EncoderHealthBanner />
		</div>
	);
}

import { signal } from '@preact/signals';
import { ComponentChildren } from 'preact';
import { FeedbackModal } from '@/components/feedback/FeedbackModal';
import { closeFeedbackModal, feedbackModalOpen } from '@/state/feedback.state';
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
			style={{
				// Exposed so the fit-height dashboard can reserve space for the
				// docked mini-player bar (the class itself is CSS-module-hashed).
				'--mu-docked-player': showMiniPlayer ? 'var(--player-bar-height)' : '0px',
				...(showSplitPlayer ? { maxWidth: `calc(100vw - ${splitWidth.value}vw)` } : {}),
			}}
		>
			<Sidebar collapsed={collapsed} onToggle={() => (sidebarCollapsed.value = !collapsed)} />
			<div class={styles.main}>
				<TopBar />
				<main class={styles.content}>{children}</main>
			</div>
			<MobileNav />
			<EncoderHealthBanner />
			<FeedbackModal isOpen={feedbackModalOpen.value} onClose={closeFeedbackModal} />
		</div>
	);
}

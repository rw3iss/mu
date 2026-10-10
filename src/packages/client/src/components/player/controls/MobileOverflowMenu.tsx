import { useEffect, useRef, useState } from 'preact/hooks';
import { showEffectsPanel, toggleEffectsPanel } from '@/state/audio-effects.state';
import { isMuted, toggleMute } from '@/state/player.state';
import { activeSession, showSessionMenu, toggleSessionMenu } from '@/state/shared-session.state';
import styles from '../PlayerControls.module.scss';
import { ChatIcon } from '../session/SessionIcons';
import { SessionMenu } from '../session/SessionMenu';
import type { ControlGroupProps } from './types';
import { VolumeIcon } from './VolumeControl';

/**
 * Mobile overflow — only visible on mobile-mini (CSS-gated). Surfaces the
 * controls hidden by the mobile-mini @media rule (info / effects / mute) so
 * touch users can still reach them without maximizing the player.
 */
export function MobileOverflowMenu({
	hasMiniThumbnail,
	onToggleInfo,
	onToggleFullscreen,
}: ControlGroupProps) {
	const [showMobileOverflow, setShowMobileOverflow] = useState(false);
	const mobileOverflowRef = useRef<HTMLDivElement>(null);

	// Close mobile overflow on outside click
	useEffect(() => {
		if (!showMobileOverflow) return;
		function handleClick(e: MouseEvent) {
			const target = e.target as HTMLElement;
			// Same portal guard as the settings menu above.
			if (target.closest?.('[role="dialog"]')) return;
			if (mobileOverflowRef.current && !mobileOverflowRef.current.contains(target as Node)) {
				setShowMobileOverflow(false);
			}
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [showMobileOverflow]);

	if (!hasMiniThumbnail) return null;
	return (
		<div class={styles.mobileOverflow} ref={mobileOverflowRef}>
			<button
				class={`${styles.controlBtn} ${showMobileOverflow ? styles.active : ''}`}
				onClick={() => setShowMobileOverflow((v) => !v)}
				aria-label="More controls"
				aria-expanded={showMobileOverflow}
				title="More"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
					<circle cx="5" cy="12" r="2" />
					<circle cx="12" cy="12" r="2" />
					<circle cx="19" cy="12" r="2" />
				</svg>
			</button>

			{showSessionMenu.value && <SessionMenu />}
			{showMobileOverflow && (
				<div class={styles.mobileOverflowMenu} role="menu">
					{activeSession.value && (
						<button
							type="button"
							class={`${styles.mobileOverflowItem} ${showSessionMenu.value ? styles.mobileOverflowItemActive : ''}`}
							onClick={() => {
								setShowMobileOverflow(false);
								toggleSessionMenu();
							}}
						>
							<ChatIcon size={18} />
							<span>Session</span>
						</button>
					)}
					<button
						type="button"
						class={styles.mobileOverflowItem}
						onClick={() => {
							setShowMobileOverflow(false);
							onToggleInfo();
						}}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="16" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12.01" y2="8" />
						</svg>
						<span>Info</span>
					</button>
					<button
						type="button"
						class={`${styles.mobileOverflowItem} ${showEffectsPanel.value ? styles.mobileOverflowItemActive : ''}`}
						onClick={() => {
							setShowMobileOverflow(false);
							toggleEffectsPanel();
						}}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<line x1="4" y1="21" x2="4" y2="14" />
							<line x1="4" y1="10" x2="4" y2="3" />
							<line x1="12" y1="21" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12" y2="3" />
							<line x1="20" y1="21" x2="20" y2="16" />
							<line x1="20" y1="12" x2="20" y2="3" />
							<line x1="1" y1="14" x2="7" y2="14" />
							<line x1="9" y1="8" x2="15" y2="8" />
							<line x1="17" y1="16" x2="23" y2="16" />
						</svg>
						<span>Effects</span>
					</button>
					<button
						type="button"
						class={styles.mobileOverflowItem}
						onClick={() => {
							toggleMute();
						}}
					>
						<VolumeIcon />
						<span>{isMuted.value ? 'Unmute' : 'Mute'}</span>
					</button>
					<button
						type="button"
						class={styles.mobileOverflowItem}
						onClick={() => {
							setShowMobileOverflow(false);
							onToggleFullscreen();
						}}
						aria-label="Maximize player"
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<polyline points="18 15 12 9 6 15" />
						</svg>
						<span>Maximize</span>
					</button>
				</div>
			)}
		</div>
	);
}

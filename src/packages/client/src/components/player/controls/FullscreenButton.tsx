import { isFullscreen } from '@/state/player.state';
import styles from '../PlayerControls.module.scss';
import type { ControlGroupProps } from './types';

/** Fullscreen toggle; in the mini player it maximizes instead. */
export function FullscreenButton({ hasMiniThumbnail, onToggleFullscreen }: ControlGroupProps) {
	return (
		<button
			class={styles.controlBtn}
			onClick={onToggleFullscreen}
			aria-label={
				hasMiniThumbnail
					? 'Maximize player'
					: isFullscreen.value
						? 'Exit fullscreen'
						: 'Enter fullscreen'
			}
			title={
				hasMiniThumbnail
					? 'Maximize'
					: isFullscreen.value
						? 'Exit fullscreen'
						: 'Fullscreen'
			}
		>
			{hasMiniThumbnail ? (
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="white"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="18 15 12 9 6 15" />
				</svg>
			) : isFullscreen.value ? (
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="white"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
				</svg>
			) : (
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="white"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
				</svg>
			)}
		</button>
	);
}

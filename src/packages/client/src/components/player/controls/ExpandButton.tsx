import { maximizePlayer, minimizePlayer, playerMode } from '@/state/globalPlayer.state';
import styles from '../PlayerControls.module.scss';

/** Audio has no fullscreen: this maximises from mini and minimises otherwise. */
export function ExpandButton() {
	const isMini = playerMode.value === 'mini';
	return (
		<button
			class={styles.controlBtn}
			onClick={() => (isMini ? maximizePlayer() : minimizePlayer())}
			aria-label={isMini ? 'Maximize player' : 'Minimize player'}
			title={isMini ? 'Maximize' : 'Minimize'}
		>
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
				{isMini ? (
					<polyline points="18 15 12 9 6 15" />
				) : (
					<polyline points="6 9 12 15 18 9" />
				)}
			</svg>
		</button>
	);
}

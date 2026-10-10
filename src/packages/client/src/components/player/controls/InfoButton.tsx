import styles from '../PlayerControls.module.scss';
import type { ControlGroupProps } from './types';

/** Info — hidden in split mode (info shown inline). */
export function InfoButton({ isSplit, onToggleInfo }: ControlGroupProps) {
	if (isSplit) return null;
	return (
		<button
			class={styles.controlBtn}
			onClick={onToggleInfo}
			aria-label="Movie info"
			title="Info"
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="white"
				stroke-width="2"
			>
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="16" x2="12" y2="12" />
				<line x1="12" y1="8" x2="12.01" y2="8" />
			</svg>
		</button>
	);
}

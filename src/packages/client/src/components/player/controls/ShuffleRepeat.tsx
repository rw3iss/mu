import { cycleRepeat, toggleShuffle } from '@/state/musicPlayer.state';
import { audioRepeat, audioShuffle } from '@/state/queue.state';
import styles from '../PlayerControls.module.scss';

/** Shuffle toggle (audio). */
export function ShuffleButton() {
	const on = audioShuffle.value;
	return (
		<button
			class={`${styles.controlBtn} ${on ? styles.toggleOn : ''}`}
			onClick={toggleShuffle}
			aria-pressed={on}
			aria-label={on ? 'Shuffle on' : 'Shuffle off'}
			title={on ? 'Shuffle: on' : 'Shuffle: off'}
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="16 3 21 3 21 8" />
				<line x1="4" y1="20" x2="21" y2="3" />
				<polyline points="21 16 21 21 16 21" />
				<line x1="15" y1="15" x2="21" y2="21" />
				<line x1="4" y1="4" x2="9" y2="9" />
			</svg>
		</button>
	);
}

/** Repeat cycle off → all → one (audio). */
export function RepeatButton() {
	const mode = audioRepeat.value;
	const label = mode === 'one' ? 'Repeat: one' : mode === 'all' ? 'Repeat: all' : 'Repeat: off';
	return (
		<button
			class={`${styles.controlBtn} ${mode !== 'off' ? styles.toggleOn : ''}`}
			onClick={cycleRepeat}
			aria-label={label}
			title={label}
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="17 1 21 5 17 9" />
				<path d="M3 11V9a4 4 0 0 1 4-4h14" />
				<polyline points="7 23 3 19 7 15" />
				<path d="M21 13v2a4 4 0 0 1-4 4H3" />
				{mode === 'one' && (
					<text
						x="12"
						y="15.5"
						text-anchor="middle"
						font-size="8"
						font-weight="700"
						fill="currentColor"
						stroke="none"
					>
						1
					</text>
				)}
			</svg>
		</button>
	);
}

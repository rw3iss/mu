import { useRef } from 'preact/hooks';
import { next, previous, skipAudio } from '@/state/musicPlayer.state';
import { isPlaying } from '@/state/player.state';
import styles from '../PlayerControls.module.scss';
import type { ControlGroupProps } from './types';

const LONG_PRESS_MS = 500;
const NUDGE_SECONDS = 10;

/**
 * Click → track action; long-press or Shift+click → ±10s nudge instead.
 * The long-press fires while held so a press doesn't also skip the track.
 */
function useTrackButton(onTrack: () => void, nudge: number) {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const longPressed = useRef(false);
	const clear = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};
	return {
		onPointerDown: (e: PointerEvent) => {
			if (e.button !== 0) return;
			longPressed.current = false;
			clear();
			timer.current = setTimeout(() => {
				longPressed.current = true;
				skipAudio(nudge);
			}, LONG_PRESS_MS);
		},
		onPointerUp: clear,
		onPointerLeave: clear,
		onClick: (e: MouseEvent) => {
			clear();
			if (longPressed.current) {
				longPressed.current = false;
				return;
			}
			if (e.shiftKey) skipAudio(nudge);
			else onTrack();
		},
	};
}

/** Audio centre transport: previous track · play/pause · next track. */
export function TrackTransport({ onTogglePlay, isSplit }: ControlGroupProps) {
	const prevBtn = useTrackButton(() => void previous(), -NUDGE_SECONDS);
	const nextBtn = useTrackButton(() => void next(), NUDGE_SECONDS);
	return (
		<div class={`${styles.centerControls} ${isSplit ? styles.centerControlsSplit : ''}`}>
			<button
				class={`${styles.controlBtn} ${styles.skipBtn}`}
				{...prevBtn}
				aria-label="Previous track (hold or Shift-click: back 10s)"
				title="Previous (hold: −10s)"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="white">
					<rect x="5" y="5" width="2.5" height="14" rx="1" />
					<path d="M19 5.5v13a.6.6 0 0 1-.92.5L8.5 12.5a.6.6 0 0 1 0-1l9.58-6.5a.6.6 0 0 1 .92.5z" />
				</svg>
			</button>
			<button
				class={`${styles.controlBtn} ${styles.playBtn}`}
				onClick={onTogglePlay}
				aria-label={isPlaying.value ? 'Pause' : 'Play'}
			>
				{isPlaying.value ? (
					<svg width="22" height="22" viewBox="0 0 24 24" fill="white">
						<rect x="6" y="4" width="4" height="16" rx="1" />
						<rect x="14" y="4" width="4" height="16" rx="1" />
					</svg>
				) : (
					<svg width="22" height="22" viewBox="0 0 24 24" fill="white">
						<path d="M8 5v14l11-7z" />
					</svg>
				)}
			</button>
			<button
				class={`${styles.controlBtn} ${styles.skipBtn}`}
				{...nextBtn}
				aria-label="Next track (hold or Shift-click: forward 10s)"
				title="Next (hold: +10s)"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="white">
					<rect x="16.5" y="5" width="2.5" height="14" rx="1" />
					<path d="M5 5.5v13a.6.6 0 0 0 .92.5l9.58-6.5a.6.6 0 0 0 0-1L5.92 5a.6.6 0 0 0-.92.5z" />
				</svg>
			</button>
		</div>
	);
}

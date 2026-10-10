import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getUiSetting } from '@/hooks/useUiSetting';
import { currentTime, duration, isPlaying } from '@/state/player.state';
import styles from '../PlayerControls.module.scss';
import type { ControlGroupProps } from './types';

/** Centre transport: skip back (with extended times), play/pause, skip forward. */
export function TransportGroup({
	onTogglePlay,
	onSeek,
	isSplit,
	playbackLocked,
}: ControlGroupProps) {
	const [skipBackOpen, setSkipBackOpen] = useState(false);
	const [skipFwdOpen, setSkipFwdOpen] = useState(false);
	const [isMobile, setIsMobile] = useState(
		() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
	);
	/** Auto-hide timers for the mobile skip-extended overlays. Reset on
	 * each interaction, default 3s, configurable via the
	 * `skip_autohide_ms` UI setting. Desktop ignores these — it uses
	 * mouseenter/mouseleave to drive open/close. */
	const skipBackHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const skipFwdHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const SKIP_AUTOHIDE_MS = getUiSetting<number>('skip_autohide_ms', 3000);

	// Track viewport size so the skip-extended overlays know whether to
	// behave as click-toggle (mobile) or hover (desktop).
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(max-width: 767px)');
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, []);

	// Schedule auto-close of the skip-back overlay (mobile only). Called
	// when the overlay opens and again on every skip-back-time tap to
	// reset the countdown.
	const armSkipBackAutoHide = useCallback(() => {
		if (skipBackHideTimer.current) clearTimeout(skipBackHideTimer.current);
		if (!isMobile) return;
		skipBackHideTimer.current = setTimeout(() => {
			setSkipBackOpen(false);
			skipBackHideTimer.current = null;
		}, SKIP_AUTOHIDE_MS);
	}, [isMobile, SKIP_AUTOHIDE_MS]);

	const armSkipFwdAutoHide = useCallback(() => {
		if (skipFwdHideTimer.current) clearTimeout(skipFwdHideTimer.current);
		if (!isMobile) return;
		skipFwdHideTimer.current = setTimeout(() => {
			setSkipFwdOpen(false);
			skipFwdHideTimer.current = null;
		}, SKIP_AUTOHIDE_MS);
	}, [isMobile, SKIP_AUTOHIDE_MS]);

	// Clean up auto-hide timers on unmount.
	useEffect(() => {
		return () => {
			if (skipBackHideTimer.current) clearTimeout(skipBackHideTimer.current);
			if (skipFwdHideTimer.current) clearTimeout(skipFwdHideTimer.current);
		};
	}, []);

	// ── Skip ──
	const skipBack = useCallback(
		(seconds: number) => {
			onSeek(Math.max(0, currentTime.value - seconds));
		},
		[onSeek],
	);

	const skipForward = useCallback(
		(seconds: number) => {
			onSeek(Math.min(duration.value, currentTime.value + seconds));
		},
		[onSeek],
	);

	const st = getUiSetting<number[]>('skip_times', [5, 10, 20]);
	const t: [number, number, number] = [st[0] ?? 5, st[1] ?? 10, st[2] ?? 20];
	return (
		<div class={`${styles.centerControls} ${isSplit ? styles.centerControlsSplit : ''}`}>
			{/* Skip Back — rollover reveals extended options */}
			<div
				class={styles.skipWrap}
				onMouseEnter={() => !isMobile && setSkipBackOpen(true)}
				onMouseLeave={() => !isMobile && setSkipBackOpen(false)}
			>
				<button
					class={`${styles.controlBtn} ${styles.skipBtn} ${skipBackOpen ? styles.skipBtnHidden : ''}`}
					disabled={playbackLocked}
					onClick={() => {
						if (isMobile) {
							// Touch: tap toggles the expanded
							// time options outward. Auto-hide
							// after a few seconds; each option
							// tap resets the timer.
							const next = !skipBackOpen;
							setSkipBackOpen(next);
							if (next) armSkipBackAutoHide();
						} else {
							skipBack(t[0]);
						}
					}}
					aria-label="Skip back"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="white"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="11 17 6 12 11 7" />
						<polyline points="18 17 13 12 18 7" />
					</svg>
				</button>
				{skipBackOpen && (
					<div class={`${styles.skipExtended} ${styles.skipExtendedLeft}`}>
						<button
							class={`${styles.controlBtn} ${styles.skipExtBtn}`}
							onClick={() => {
								skipBack(t[2]);
								armSkipBackAutoHide();
							}}
							aria-label={`Skip back ${t[2]}s`}
						>
							<span class={styles.skipExtText}>{t[2]}s</span>
						</button>
						<button
							class={`${styles.controlBtn} ${styles.skipExtBtn}`}
							onClick={() => {
								skipBack(t[1]);
								armSkipBackAutoHide();
							}}
							aria-label={`Skip back ${t[1]}s`}
						>
							<span class={styles.skipExtText}>{t[1]}s</span>
						</button>
						<button
							class={`${styles.controlBtn} ${styles.skipExtBtn}`}
							onClick={() => {
								skipBack(t[0]);
								armSkipBackAutoHide();
							}}
							aria-label={`Skip back ${t[0]}s`}
						>
							<span class={styles.skipExtText}>{t[0]}s</span>
						</button>
					</div>
				)}
			</div>

			<button
				class={`${styles.controlBtn} ${styles.playBtn}`}
				onClick={onTogglePlay}
				disabled={playbackLocked}
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

			{/* Skip Forward — rollover reveals extended options */}
			<div
				class={styles.skipWrap}
				onMouseEnter={() => !isMobile && setSkipFwdOpen(true)}
				onMouseLeave={() => !isMobile && setSkipFwdOpen(false)}
			>
				<button
					class={`${styles.controlBtn} ${styles.skipBtn} ${skipFwdOpen ? styles.skipBtnHidden : ''}`}
					disabled={playbackLocked}
					onClick={() => {
						if (isMobile) {
							const next = !skipFwdOpen;
							setSkipFwdOpen(next);
							if (next) armSkipFwdAutoHide();
						} else {
							skipForward(t[0]);
						}
					}}
					aria-label="Skip forward"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="white"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="13 17 18 12 13 7" />
						<polyline points="6 17 11 12 6 7" />
					</svg>
				</button>
				{skipFwdOpen && (
					<div class={`${styles.skipExtended} ${styles.skipExtendedRight}`}>
						<button
							class={`${styles.controlBtn} ${styles.skipExtBtn}`}
							onClick={() => {
								skipForward(t[0]);
								armSkipFwdAutoHide();
							}}
							aria-label={`Skip forward ${t[0]}s`}
						>
							<span class={styles.skipExtText}>{t[0]}s</span>
						</button>
						<button
							class={`${styles.controlBtn} ${styles.skipExtBtn}`}
							onClick={() => {
								skipForward(t[1]);
								armSkipFwdAutoHide();
							}}
							aria-label={`Skip forward ${t[1]}s`}
						>
							<span class={styles.skipExtText}>{t[1]}s</span>
						</button>
						<button
							class={`${styles.controlBtn} ${styles.skipExtBtn}`}
							onClick={() => {
								skipForward(t[2]);
								armSkipFwdAutoHide();
							}}
							aria-label={`Skip forward ${t[2]}s`}
						>
							<span class={styles.skipExtText}>{t[2]}s</span>
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

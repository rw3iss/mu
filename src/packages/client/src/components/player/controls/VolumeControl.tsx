import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isMuted, setVolume, toggleMute, volume } from '@/state/player.state';
import styles from '../PlayerControls.module.scss';

/**
 * Volume button + popup slider. Hover the button to reveal the popup,
 * mouse away to dismiss after a short delay. Click the button to
 * mute/unmute. The popup's entire width is a live drag target — see
 * the `.volumeSlider` SCSS for the centered visible track trick.
 *
 * Extracted from PlayerControls.tsx as part of the Phase C
 * decomposition documented in docs/improvement-audit-2026-05-27.md.
 * Shares its SCSS module with the parent so descendant selectors
 * (`.controls.miniMode .volumeWrap …`) still resolve.
 */
export function VolumeControl() {
	const [showVolume, setShowVolume] = useState(false);
	const volumeRef = useRef<HTMLDivElement>(null);
	const volumeHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (volumeHoverTimer.current) clearTimeout(volumeHoverTimer.current);
		};
	}, []);

	const handleVolumeChange = useCallback((e: Event) => {
		const target = e.target as HTMLInputElement;
		setVolume(parseFloat(target.value));
	}, []);

	const handleVolumeEnter = useCallback(() => {
		if (volumeHoverTimer.current) clearTimeout(volumeHoverTimer.current);
		volumeHoverTimer.current = setTimeout(() => setShowVolume(true), 100);
	}, []);

	const handleVolumeLeave = useCallback(() => {
		if (volumeHoverTimer.current) clearTimeout(volumeHoverTimer.current);
		volumeHoverTimer.current = setTimeout(() => setShowVolume(false), 200);
	}, []);

	return (
		<div
			class={styles.volumeWrap}
			ref={volumeRef}
			onMouseEnter={handleVolumeEnter}
			onMouseLeave={handleVolumeLeave}
		>
			<button
				class={styles.controlBtn}
				onClick={toggleMute}
				aria-label={isMuted.value ? 'Unmute' : 'Mute'}
			>
				<VolumeIcon />
			</button>

			{showVolume && (
				<div class={styles.volumePopup}>
					<input
						type="range"
						class={styles.volumeSlider}
						min="0"
						max="1"
						step="0.05"
						value={isMuted.value ? 0 : volume.value}
						onInput={handleVolumeChange}
						aria-label="Volume"
						// @ts-expect-error — preact passes through, Firefox-only attr
						orient="vertical"
					/>
				</div>
			)}
		</div>
	);
}

/**
 * Speaker icon that swaps between 4 visual states based on the current
 * volume signal: muted (X over speaker), low (1 wave), mid (2 waves),
 * high (3 waves). Exported so the MobileOverflowMenu (which has its
 * own mute button) can reuse the same iconography.
 */
export function VolumeIcon() {
	const v = volume.value;
	const muted = isMuted.value || v === 0;

	const speakerBody = (
		<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="white" stroke="none" />
	);

	if (muted) {
		return (
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
				{speakerBody}
				<line x1="23" y1="9" x2="17" y2="15" />
				<line x1="17" y1="9" x2="23" y2="15" />
			</svg>
		);
	}

	if (v <= 0.32) {
		return (
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
				{speakerBody}
				<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
			</svg>
		);
	}

	if (v <= 0.66) {
		return (
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
				{speakerBody}
				<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
				<path d="M17.7 6.3a7.5 7.5 0 0 1 0 11.4" />
			</svg>
		);
	}

	return (
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
			{speakerBody}
			<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
			<path d="M17.7 6.3a7.5 7.5 0 0 1 0 11.4" />
			<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
		</svg>
	);
}

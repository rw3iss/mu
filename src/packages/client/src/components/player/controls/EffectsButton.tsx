import {
	bassEnhanceEnabled,
	compressorEnabled,
	eqEnabled,
	hrtfSurroundEnabled,
	showEffectsPanel,
	stereoWidthEnabled,
	toggleEffectsPanel,
	videoEnabled,
} from '@/state/audio-effects.state';
import { activeKind } from '@/state/globalPlayer.state';
import styles from '../PlayerControls.module.scss';

/**
 * Effects panel toggle, with EQ / compressor dots on top and a third dot
 * below: video effects for video, the Enhance tab (stereo width, bass
 * enhance, HRTF surround) for music, where video effects don't apply.
 */
export function EffectsButton() {
	const thirdOn =
		activeKind.value === 'audio'
			? stereoWidthEnabled.value || bassEnhanceEnabled.value || hrtfSurroundEnabled.value
			: videoEnabled.value;
	return (
		<div class={styles.effectsBtnWrap}>
			<div class={styles.effectsDots}>
				<span
					class={`${styles.effectsDot} ${eqEnabled.value ? styles.effectsDotActive : ''}`}
				/>
				<span
					class={`${styles.effectsDot} ${compressorEnabled.value ? styles.effectsDotActive : ''}`}
				/>
			</div>
			<div class={styles.effectsDotsBottom}>
				<span class={`${styles.effectsDot} ${thirdOn ? styles.effectsDotActive : ''}`} />
			</div>
			<button
				class={`${styles.controlBtn} ${showEffectsPanel.value ? styles.active : ''}`}
				onClick={toggleEffectsPanel}
				aria-label="Audio effects"
				title="Effects"
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
			</button>
		</div>
	);
}

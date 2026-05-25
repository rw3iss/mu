import type { AudioProfile } from '@/services/audio-profiles.service';
import {
	bassEnhanceEnabled,
	compressorEnabled,
	effectsTab,
	eqEnabled,
	hrtfSurroundEnabled,
	setEffectsTab,
	showEffectsPanel,
	stereoWidthEnabled,
	toggleEffectsPanel,
} from '@/state/audio-effects.state';
import {
	activeCompProfileId,
	activeEqProfileId,
	activeVideoProfileId,
	profiles,
} from '@/state/audio-profiles.state';
import { audioOutputSuspect, requestAudioReset } from '@/state/audio-reset.state';
import { videoEnabled } from '@/state/video-effects.state';
import styles from './EffectsPanel.module.scss';
import { CompressorTab } from './effects/CompressorTab';
import { EnhanceTab } from './effects/EnhanceTab';
import { EqTab } from './effects/EqTab';
import { VideoTab } from './effects/VideoTab';

/**
 * Shell for the in-player effects panel: header, tab strip, body.
 * The actual EQ / Compressor / Video controls live in
 * `effects/{Eq,Compressor,Video}Tab.tsx`. Profile dropdown and the
 * collapsible-settings twisty are in `effects/ProfileControls.tsx`
 * and `effects/CollapsibleSettings.tsx` so each tab composes its
 * own surface without copy-pasting plumbing.
 */

function getActiveProfileName(allProfiles: AudioProfile[], activeId: string | null): string | null {
	if (!activeId) return null;
	const p = allProfiles.find((pr) => pr.id === activeId);
	return p?.name ?? null;
}

export function EffectsPanel() {
	if (!showEffectsPanel.value) return null;

	const tab = effectsTab.value;
	const allProfiles = profiles.value;
	const isEqEnabled = eqEnabled.value;
	const isCompEnabled = compressorEnabled.value;
	const isVideoEnabled = videoEnabled.value;
	const isAnyEnhanceOn =
		stereoWidthEnabled.value || bassEnhanceEnabled.value || hrtfSurroundEnabled.value;
	const eqProfileName = getActiveProfileName(allProfiles, activeEqProfileId.value);
	const compProfileName = getActiveProfileName(allProfiles, activeCompProfileId.value);
	const videoProfileName = getActiveProfileName(allProfiles, activeVideoProfileId.value);

	return (
		<div
			class={styles.panel}
			data-player-panel
			data-effects-panel
			onClick={(e) => e.stopPropagation()}
		>
			<div class={styles.header}>
				<span class={styles.headerTitle}>Effects</span>
				<div class={styles.headerActions}>
					<button
						class={styles.resetAudioBtn}
						onClick={requestAudioReset}
						title={
							audioOutputSuspect.value.suspect
								? `Audio output may be stuck (${audioOutputSuspect.value.reason}). Click to reset.`
								: 'Reset audio output — use if EQ/Compressor stops sound. Restarts the video at the current position.'
						}
						data-suspect={audioOutputSuspect.value.suspect ? 'true' : 'false'}
						aria-label="Reset audio output"
					>
						Reset Audio
					</button>
					<button class={styles.closeBtn} onClick={toggleEffectsPanel} aria-label="Close">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
			</div>

			<div class={styles.tabs}>
				<button
					class={`${styles.tab} ${tab === 'eq' ? styles.active : ''}`}
					onClick={() => setEffectsTab('eq')}
				>
					<span>EQ{isEqEnabled && <span class={styles.onBadge}>ON</span>}</span>
					{eqProfileName && <span class={styles.tabProfileName}>{eqProfileName}</span>}
				</button>
				<button
					class={`${styles.tab} ${tab === 'compressor' ? styles.active : ''}`}
					onClick={() => setEffectsTab('compressor')}
				>
					<span>Comp{isCompEnabled && <span class={styles.onBadge}>ON</span>}</span>
					{compProfileName && (
						<span class={styles.tabProfileName}>{compProfileName}</span>
					)}
				</button>
				<button
					class={`${styles.tab} ${tab === 'enhance' ? styles.active : ''}`}
					onClick={() => setEffectsTab('enhance')}
				>
					<span>
						Enhance
						{isAnyEnhanceOn && <span class={styles.onBadge}>ON</span>}
					</span>
				</button>
				<button
					class={`${styles.tab} ${tab === 'video' ? styles.active : ''}`}
					onClick={() => setEffectsTab('video')}
				>
					<span>Video{isVideoEnabled && <span class={styles.onBadge}>ON</span>}</span>
					{videoProfileName && (
						<span class={styles.tabProfileName}>{videoProfileName}</span>
					)}
				</button>
			</div>

			<div class={styles.body}>
				{tab === 'eq' && <EqTab />}
				{tab === 'compressor' && <CompressorTab />}
				{tab === 'enhance' && <EnhanceTab />}
				{tab === 'video' && <VideoTab />}
			</div>
		</div>
	);
}

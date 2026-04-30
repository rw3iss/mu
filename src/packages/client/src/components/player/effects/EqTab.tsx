import { ToggleButton } from '@/components/common/ToggleButton';
import {
	eqBands,
	eqEnabled,
	eqInputGain,
	resetEq,
	spectrumEnabled,
	toggleEq,
	toggleSpectrum,
	updateEqBand,
	updateInputGain,
} from '@/state/audio-effects.state';
import {
	activeEqProfileId,
	loadEqProfile,
	saveEqProfile,
	updateEqProfile,
} from '@/state/audio-profiles.state';
import styles from '../EffectsPanel.module.scss';
import { EqSpectrum } from '../EqSpectrum';
import { CollapsibleSettings } from './CollapsibleSettings';
import { ProfileControls } from './ProfileControls';

function formatFreq(hz: number): string {
	return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

export function EqTab() {
	const bands = eqBands.value;
	const enabled = eqEnabled.value;
	const inputGain = eqInputGain.value;
	const activeId = activeEqProfileId.value;
	const spectrumOn = spectrumEnabled.value;

	return (
		<div>
			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>Equalizer</span>
				<button
					class={`${styles.toggle} ${enabled ? styles.on : ''}`}
					onClick={toggleEq}
					aria-label="Toggle EQ"
				/>
			</div>

			<ProfileControls
				type="eq"
				activeId={activeId}
				onLoad={loadEqProfile}
				onSave={saveEqProfile}
				onUpdate={updateEqProfile}
			/>

			<CollapsibleSettings settingKey="effects_eq_settings_open">
				<div class={styles.eqGridWrap}>
					{spectrumOn && <EqSpectrum />}
					<div class={styles.eqGrid}>
						<div class={styles.eqBand}>
							<span class={styles.eqValue}>
								{inputGain > 0 ? '+' : ''}
								{inputGain.toFixed(1)}
							</span>
							<input
								type="range"
								class={styles.eqSlider}
								min="-12"
								max="12"
								step="0.5"
								value={inputGain}
								onInput={(e) =>
									updateInputGain(
										parseFloat((e.target as HTMLInputElement).value),
									)
								}
								onDblClick={() => updateInputGain(0)}
							/>
							<span class={`${styles.eqLabel} ${styles.eqLabelAmp}`}>Amp</span>
						</div>
						{bands.map((band, i) => (
							<div class={styles.eqBand} key={band.frequency}>
								<span class={styles.eqValue}>
									{band.gain > 0 ? '+' : ''}
									{band.gain.toFixed(1)}
								</span>
								<input
									type="range"
									class={styles.eqSlider}
									min="-12"
									max="12"
									step="0.5"
									value={band.gain}
									onInput={(e) =>
										updateEqBand(
											i,
											parseFloat((e.target as HTMLInputElement).value),
										)
									}
									onDblClick={() => updateEqBand(i, 0)}
								/>
								<span class={styles.eqLabel}>{formatFreq(band.frequency)}</span>
							</div>
						))}
					</div>
				</div>

				<div class={styles.eqActions}>
					<button class={styles.resetBtn} onClick={resetEq}>
						Reset EQ
					</button>
					<ToggleButton pressed={spectrumOn} onClick={toggleSpectrum}>
						Spectrum
					</ToggleButton>
				</div>
			</CollapsibleSettings>
		</div>
	);
}

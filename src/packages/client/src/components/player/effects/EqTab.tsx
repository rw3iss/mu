import { ToggleButton } from '@/components/common/ToggleButton';
import {
	autoEqFactor,
	autoEqOpen,
	autoEqRunning,
	autoEqSampleSeconds,
	eqBands,
	eqEnabled,
	eqInputGain,
	resetEq,
	runAutoEq,
	setAutoEqFactor,
	setAutoEqSampleSeconds,
	spectrumEnabled,
	toggleAutoEqControls,
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
	const autoOpen = autoEqOpen.value;
	const autoRunning = autoEqRunning.value;
	const autoSeconds = autoEqSampleSeconds.value;
	const autoFactor = autoEqFactor.value;

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
					<ToggleButton onClick={resetEq}>Reset EQ</ToggleButton>
					<ToggleButton pressed={spectrumOn} onClick={toggleSpectrum}>
						Spectrum
					</ToggleButton>
					<ToggleButton pressed={autoOpen} onClick={toggleAutoEqControls}>
						Auto
					</ToggleButton>
				</div>

				{autoOpen && (
					<div class={styles.autoPanel}>
						<div class={styles.autoField}>
							<label class={styles.autoLabel} for="autoEqSeconds">
								Sample Secs
								<span
									class={styles.autoHelp}
									title="How many seconds of audio to capture before computing the band averages. Longer samples are more representative; 2–4 seconds is usually plenty."
								>
									?
								</span>
							</label>
							<input
								id="autoEqSeconds"
								type="number"
								min={1}
								max={10}
								step={1}
								value={autoSeconds}
								disabled={autoRunning}
								onInput={(e) =>
									setAutoEqSampleSeconds(
										parseInt((e.target as HTMLInputElement).value, 10),
									)
								}
								class={styles.autoSeconds}
							/>
						</div>

						<div class={`${styles.autoField} ${styles.autoFieldFactor}`}>
							<label class={styles.autoLabel} for="autoEqFactor">
								Factor
								<span class={styles.autoValue}>{autoFactor.toFixed(1)}</span>
								<span
									class={styles.autoHelp}
									title="Strength of the correction. 1.0 applies the full flattening offset to each band; 0.5 applies half (subtler); 0.1 is barely audible. Default 0.5 — full strength tends to over-correct."
								>
									?
								</span>
							</label>
							<input
								id="autoEqFactor"
								type="range"
								min={0.1}
								max={1}
								step={0.1}
								value={autoFactor}
								disabled={autoRunning}
								onInput={(e) =>
									setAutoEqFactor(
										parseFloat((e.target as HTMLInputElement).value),
									)
								}
								class={styles.autoFactorSlider}
							/>
						</div>

						<div class={styles.autoRunWrap}>
							<button
								type="button"
								class={styles.autoRunBtn}
								onClick={() => {
									runAutoEq();
								}}
								disabled={autoRunning}
								title={
									autoRunning
										? 'Sampling…'
										: `Sample for ${autoSeconds}s and apply correction at ${autoFactor.toFixed(1)}× strength`
								}
								aria-label="Run auto-EQ sampler"
							>
								{autoRunning ? (
									<span class={styles.autoSpinner} aria-hidden="true" />
								) : (
									<>
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="currentColor"
											aria-hidden="true"
										>
											<polygon points="6,4 20,12 6,20" />
										</svg>
										Sample
									</>
								)}
							</button>
						</div>
					</div>
				)}
			</CollapsibleSettings>
		</div>
	);
}

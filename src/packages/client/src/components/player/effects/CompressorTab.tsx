import { useEffect, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import { ToggleButton } from '@/components/common/ToggleButton';
import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import {
	autoCompFactor,
	autoCompOpen,
	autoCompRunning,
	autoCompSampleSeconds,
	compressorEnabled,
	compressorSettings,
	compressorVisualizerEnabled,
	resetCompressor,
	runAutoComp,
	setAutoCompFactor,
	setAutoCompSampleSeconds,
	toggleAutoCompControls,
	toggleCompressor,
	toggleCompressorVisualizer,
	updateCompressorParam,
} from '@/state/audio-effects.state';
import {
	activeCompProfileId,
	loadCompProfile,
	saveCompProfile,
	updateCompProfile,
} from '@/state/audio-profiles.state';
import { CompressorCurve } from '../CompressorCurve';
import styles from '../EffectsPanel.module.scss';
import { CollapsibleSettings } from './CollapsibleSettings';
import { ProfileControls } from './ProfileControls';

const COMP_PARAMS = [
	{ key: 'threshold' as const, label: 'Threshold', min: -100, max: 0, step: 1, unit: 'dB' },
	{ key: 'knee' as const, label: 'Knee', min: 0, max: 40, step: 1, unit: 'dB' },
	{ key: 'ratio' as const, label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
	{ key: 'attack' as const, label: 'Attack', min: 0, max: 1, step: 0.001, unit: 's' },
	{ key: 'release' as const, label: 'Release', min: 0, max: 1, step: 0.01, unit: 's' },
	{
		key: 'makeupGain' as const,
		label: 'Makeup Gain',
		min: 0,
		max: 24,
		step: 0.5,
		unit: 'dB',
	},
];

export function CompressorTab() {
	const enabled = compressorEnabled.value;
	const settings = compressorSettings.value;
	const activeId = activeCompProfileId.value;
	const visualizerOn = compressorVisualizerEnabled.value;
	const autoOpen = autoCompOpen.value;
	const autoRunning = autoCompRunning.value;
	const autoSeconds = autoCompSampleSeconds.value;
	const autoFactor = autoCompFactor.value;
	const [reduction, setReduction] = useState(0);

	useAnimationFrame(() => {
		setReduction(audioEngine.getCompressorReduction());
	}, enabled);
	useEffect(() => {
		if (!enabled) setReduction(0);
	}, [enabled]);

	return (
		<div>
			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>Compressor</span>
				<button
					class={`${styles.toggle} ${enabled ? styles.on : ''}`}
					onClick={toggleCompressor}
					aria-label="Toggle Compressor"
				/>
			</div>

			<ProfileControls
				type="compressor"
				activeId={activeId}
				onLoad={loadCompProfile}
				onSave={saveCompProfile}
				onUpdate={updateCompProfile}
			/>

			<CollapsibleSettings settingKey="effects_comp_settings_open">
				<div class={styles.compParamsWrap}>
					{visualizerOn && <CompressorCurve />}
					<div class={styles.compParamsInner}>
						{COMP_PARAMS.map((param) => (
							<div class={styles.compParam} key={param.key}>
								<div class={styles.compParamHeader}>
									<span class={styles.compParamLabel}>{param.label}</span>
									<span class={styles.compParamValue}>
										{param.key === 'attack' || param.key === 'release'
											? settings[param.key].toFixed(3)
											: settings[param.key].toFixed(1)}
										{param.unit}
									</span>
								</div>
								<input
									type="range"
									class={styles.compSlider}
									min={param.min}
									max={param.max}
									step={param.step}
									value={settings[param.key]}
									onInput={(e) =>
										updateCompressorParam(
											param.key,
											parseFloat((e.target as HTMLInputElement).value),
										)
									}
								/>
							</div>
						))}
					</div>
				</div>

				{enabled && (
					<div class={styles.reductionMeter}>
						<div class={styles.reductionLabel}>
							Gain Reduction: {reduction.toFixed(1)} dB
						</div>
						<div class={styles.reductionBar}>
							<div
								class={styles.reductionFill}
								style={{
									width: `${Math.min(100, Math.abs(reduction) * 2)}%`,
								}}
							/>
						</div>
					</div>
				)}

				<div class={styles.compParam}>
					<div class={styles.compParamHeader}>
						<span class={styles.compParamLabel}>Mix</span>
						<span class={styles.compParamValue}>
							{Math.round((settings.mix ?? 1) * 100)}%
						</span>
					</div>
					<div class={styles.mixBar}>
						<span class={styles.mixLabel}>Dry</span>
						<input
							type="range"
							class={styles.compSlider}
							min={0}
							max={1}
							step={0.01}
							value={settings.mix ?? 1}
							onInput={(e) =>
								updateCompressorParam(
									'mix',
									parseFloat((e.target as HTMLInputElement).value),
								)
							}
						/>
						<span class={styles.mixLabel}>Wet</span>
					</div>
				</div>

				<div class={styles.eqActions}>
					<ToggleButton onClick={resetCompressor}>Reset Compressor</ToggleButton>
					<ToggleButton pressed={visualizerOn} onClick={toggleCompressorVisualizer}>
						Visualize
					</ToggleButton>
					<ToggleButton pressed={autoOpen} onClick={toggleAutoCompControls}>
						Auto
					</ToggleButton>
				</div>

				{autoOpen && (
					<div class={styles.autoPanel}>
						<div class={styles.autoField}>
							<label class={styles.autoLabel} for="autoCompSeconds">
								Sample Secs
								<span
									class={styles.autoHelp}
									title="How many seconds of audio to capture before measuring peak and RMS levels. Longer samples are more representative of the source's typical dynamics; 2–4 seconds is usually plenty."
								>
									?
								</span>
							</label>
							<input
								id="autoCompSeconds"
								type="number"
								min={1}
								max={10}
								step={1}
								value={autoSeconds}
								disabled={autoRunning}
								onInput={(e) =>
									setAutoCompSampleSeconds(
										parseInt((e.target as HTMLInputElement).value, 10),
									)
								}
								class={styles.autoSeconds}
							/>
						</div>

						<div class={`${styles.autoField} ${styles.autoFieldFactor}`}>
							<label class={styles.autoLabel} for="autoCompFactor">
								Factor
								<span class={styles.autoValue}>{autoFactor.toFixed(1)}</span>
								<span
									class={styles.autoHelp}
									title="Strength of the derived compression. 1.0 applies the full computed threshold/ratio/makeup; 0.5 blends halfway between no compression and the computed values; 0.1 is a barely-audible nudge. Default 0.5 — full strength can squash dynamics on already-loud sources."
								>
									?
								</span>
							</label>
							<input
								id="autoCompFactor"
								type="range"
								min={0.1}
								max={1}
								step={0.1}
								value={autoFactor}
								disabled={autoRunning}
								onInput={(e) =>
									setAutoCompFactor(
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
									runAutoComp();
								}}
								disabled={autoRunning}
								title={
									autoRunning
										? 'Sampling…'
										: `Sample for ${autoSeconds}s and apply derived compressor settings at ${autoFactor.toFixed(1)}× strength`
								}
								aria-label="Run auto-Compressor sampler"
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

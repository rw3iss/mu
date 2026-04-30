import { useEffect, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import { ToggleButton } from '@/components/common/ToggleButton';
import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import {
	compressorEnabled,
	compressorSettings,
	compressorVisualizerEnabled,
	resetCompressor,
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
					<button class={styles.resetBtn} onClick={resetCompressor}>
						Reset Compressor
					</button>
					<ToggleButton pressed={visualizerOn} onClick={toggleCompressorVisualizer}>
						Visualize
					</ToggleButton>
				</div>
			</CollapsibleSettings>
		</div>
	);
}

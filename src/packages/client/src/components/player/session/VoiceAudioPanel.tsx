import { useEffect, useState } from 'preact/hooks';
import { micAudioEngine } from '@/audio/mic-audio-engine';
import { Spinner } from '@/components/common/Spinner';
import { ToggleButton } from '@/components/common/ToggleButton';
import { useAnimationFrame } from '@/hooks/useAnimationFrame';
import { sharedSessionService } from '@/services/shared-session.service';
import {
	closeVoicePanel,
	duckMovieEnabled,
	setDuckMovieEnabled,
	showVoicePanel,
} from '@/state/shared-session.state';
import {
	initVoiceEffects,
	resetVoiceCompressor,
	resetVoiceEq,
	runVoiceAutoComp,
	runVoiceAutoEq,
	setVoiceAutoCompFactor,
	setVoiceAutoCompSampleSeconds,
	setVoiceAutoEqFactor,
	setVoiceAutoEqSampleSeconds,
	toggleVoiceAutoCompControls,
	toggleVoiceAutoEqControls,
	toggleVoiceCompressor,
	toggleVoiceCompressorVisualizer,
	toggleVoiceEq,
	toggleVoiceSpectrum,
	updateVoiceCompressorParam,
	updateVoiceEqBand,
	updateVoiceInputGain,
	voiceAutoCompFactor,
	voiceAutoCompOpen,
	voiceAutoCompRunning,
	voiceAutoCompSampleSeconds,
	voiceAutoEqFactor,
	voiceAutoEqOpen,
	voiceAutoEqRunning,
	voiceAutoEqSampleSeconds,
	voiceCompressorEnabled,
	voiceCompressorSettings,
	voiceCompressorVisualizerEnabled,
	voiceEqBands,
	voiceEqEnabled,
	voiceEqInputGain,
	voiceSpectrumEnabled,
} from '@/state/voice-effects.state';
import fx from '../EffectsPanel.module.scss';
import { VoiceCompressorCurve } from './VoiceCompressorCurve';
import { VoiceEqSpectrum } from './VoiceEqSpectrum';
import styles from './VoicePanel.module.scss';

function formatFreq(hz: number): string {
	return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

const COMP_PARAMS = [
	{ key: 'threshold' as const, label: 'Threshold', min: -100, max: 0, step: 1, unit: 'dB' },
	{ key: 'knee' as const, label: 'Knee', min: 0, max: 40, step: 1, unit: 'dB' },
	{ key: 'ratio' as const, label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
	{ key: 'attack' as const, label: 'Attack', min: 0, max: 1, step: 0.001, unit: 's' },
	{ key: 'release' as const, label: 'Release', min: 0, max: 1, step: 0.01, unit: 's' },
	{ key: 'makeupGain' as const, label: 'Makeup Gain', min: 0, max: 24, step: 0.5, unit: 'dB' },
];

/**
 * Slide-in voice-config panel: input device, input volume, per-user
 * duck-movie toggle, and EQ + Compressor (sliders + visualizers + auto),
 * bound to `voice-effects.state` + `micAudioEngine`. Mirrors the playback
 * EQ/Compressor tabs without touching them.
 */
export function VoiceAudioPanel() {
	const visible = showVoicePanel.value;

	const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
	const [deviceId, setDeviceId] = useState('');
	const [reduction, setReduction] = useState(0);

	// Init voice effects + load device list the first time the panel opens.
	useEffect(() => {
		if (!visible) return;
		initVoiceEffects();
		sharedSessionService
			.listInputDevices()
			.then((list) => setDevices(list))
			.catch(() => setDevices([]));
	}, [visible]);

	const compEnabled = voiceCompressorEnabled.value;
	useAnimationFrame(() => {
		setReduction(micAudioEngine.getCompressorReduction());
	}, visible && compEnabled);
	useEffect(() => {
		if (!compEnabled) setReduction(0);
	}, [compEnabled]);

	if (!visible) return null;

	const bands = voiceEqBands.value;
	const eqEnabled = voiceEqEnabled.value;
	const inputGain = voiceEqInputGain.value;
	const spectrumOn = voiceSpectrumEnabled.value;
	const eqAutoOpen = voiceAutoEqOpen.value;
	const eqAutoRunning = voiceAutoEqRunning.value;
	const comp = voiceCompressorSettings.value;
	const visualizerOn = voiceCompressorVisualizerEnabled.value;
	const compAutoOpen = voiceAutoCompOpen.value;
	const compAutoRunning = voiceAutoCompRunning.value;

	const onDeviceChange = (id: string) => {
		setDeviceId(id);
		void sharedSessionService.setInputDevice(id);
	};

	return (
		<div
			class={styles.panel}
			data-player-panel
			data-voice-panel
			onClick={(e) => e.stopPropagation()}
		>
			<div class={styles.header}>
				<span class={styles.headerTitle}>Voice Audio</span>
				<button class={styles.closeBtn} onClick={closeVoicePanel} aria-label="Close">
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

			<div class={styles.body}>
				{/* ── Input ── */}
				<div class={styles.field}>
					<label class={styles.fieldLabel} for="voiceDevice">
						Input device
					</label>
					<select
						id="voiceDevice"
						class={styles.select}
						value={deviceId}
						onChange={(e) => onDeviceChange((e.target as HTMLSelectElement).value)}
					>
						<option value="">Default</option>
						{devices.map((d) => (
							<option key={d.deviceId} value={d.deviceId}>
								{d.label}
							</option>
						))}
					</select>
				</div>

				<div class={styles.field}>
					<div class={styles.sliderHeader}>
						<label class={styles.fieldLabel} for="voiceVolume">
							Input volume
						</label>
						<span class={styles.sliderValue}>
							{inputGain > 0 ? '+' : ''}
							{inputGain.toFixed(1)} dB
						</span>
					</div>
					<input
						id="voiceVolume"
						type="range"
						class={styles.hSlider}
						min="-12"
						max="12"
						step="0.5"
						value={inputGain}
						onInput={(e) =>
							updateVoiceInputGain(parseFloat((e.target as HTMLInputElement).value))
						}
						onDblClick={() => updateVoiceInputGain(0)}
					/>
				</div>

				<div class={fx.toggleRow}>
					<span class={fx.toggleLabel}>Duck movie while others talk</span>
					<button
						class={`${fx.toggle} ${duckMovieEnabled.value ? fx.on : ''}`}
						onClick={() => setDuckMovieEnabled(!duckMovieEnabled.value)}
						aria-label="Duck movie while others talk"
						aria-pressed={duckMovieEnabled.value}
					/>
				</div>

				<div class={styles.divider} />

				{/* ── EQ ── */}
				<div class={fx.toggleRow}>
					<span class={fx.toggleLabel}>Equalizer</span>
					<button
						class={`${fx.toggle} ${eqEnabled ? fx.on : ''}`}
						onClick={toggleVoiceEq}
						aria-label="Toggle voice EQ"
						aria-pressed={eqEnabled}
					/>
				</div>

				<div class={fx.eqGridWrap}>
					{spectrumOn && <VoiceEqSpectrum />}
					<div class={fx.eqGrid}>
						{bands.map((band, i) => (
							<div class={fx.eqBand} key={band.frequency}>
								<span class={fx.eqValue}>
									{band.gain > 0 ? '+' : ''}
									{band.gain.toFixed(1)}
								</span>
								<input
									type="range"
									class={fx.eqSlider}
									min="-12"
									max="12"
									step="0.5"
									value={band.gain}
									onInput={(e) =>
										updateVoiceEqBand(
											i,
											parseFloat((e.target as HTMLInputElement).value),
										)
									}
									onDblClick={() => updateVoiceEqBand(i, 0)}
								/>
								<span class={fx.eqLabel}>{formatFreq(band.frequency)}</span>
							</div>
						))}
					</div>
				</div>

				<div class={fx.eqActions}>
					<ToggleButton onClick={resetVoiceEq}>Reset EQ</ToggleButton>
					<ToggleButton pressed={spectrumOn} onClick={toggleVoiceSpectrum}>
						Spectrum
					</ToggleButton>
					<ToggleButton pressed={eqAutoOpen} onClick={toggleVoiceAutoEqControls}>
						Auto
					</ToggleButton>
				</div>

				{eqAutoOpen && (
					<div class={fx.autoPanel}>
						<div class={fx.autoField}>
							<label class={fx.autoLabel} for="voiceAutoEqSeconds">
								Sample Secs
							</label>
							<input
								id="voiceAutoEqSeconds"
								type="number"
								min={1}
								max={10}
								step={1}
								value={voiceAutoEqSampleSeconds.value}
								disabled={eqAutoRunning}
								onInput={(e) =>
									setVoiceAutoEqSampleSeconds(
										parseInt((e.target as HTMLInputElement).value, 10),
									)
								}
								class={fx.autoSeconds}
							/>
						</div>
						<div class={`${fx.autoField} ${fx.autoFieldFactor}`}>
							<label class={fx.autoLabel} for="voiceAutoEqFactor">
								Factor
								<span class={fx.autoValue}>
									{voiceAutoEqFactor.value.toFixed(2)}
								</span>
							</label>
							<input
								id="voiceAutoEqFactor"
								type="range"
								min={0.05}
								max={0.8}
								step={0.05}
								value={voiceAutoEqFactor.value}
								disabled={eqAutoRunning}
								onInput={(e) =>
									setVoiceAutoEqFactor(
										parseFloat((e.target as HTMLInputElement).value),
									)
								}
								class={fx.autoFactorSlider}
							/>
						</div>
						<div class={fx.autoRunWrap}>
							<button
								type="button"
								class={fx.autoRunBtn}
								onClick={() => runVoiceAutoEq()}
								disabled={eqAutoRunning}
								aria-label="Run voice auto-EQ sampler"
							>
								{eqAutoRunning ? (
									<Spinner size="xs" />
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

				<div class={styles.divider} />

				{/* ── Compressor ── */}
				<div class={fx.toggleRow}>
					<span class={fx.toggleLabel}>Compressor</span>
					<button
						class={`${fx.toggle} ${compEnabled ? fx.on : ''}`}
						onClick={toggleVoiceCompressor}
						aria-label="Toggle voice compressor"
						aria-pressed={compEnabled}
					/>
				</div>

				<div class={fx.compParamsWrap}>
					{visualizerOn && <VoiceCompressorCurve />}
					<div class={fx.compParamsInner}>
						{COMP_PARAMS.map((param) => (
							<div class={fx.compParam} key={param.key}>
								<div class={fx.compParamHeader}>
									<span class={fx.compParamLabel}>{param.label}</span>
									<span class={fx.compParamValue}>
										{param.key === 'attack' || param.key === 'release'
											? comp[param.key].toFixed(3)
											: comp[param.key].toFixed(1)}
										{param.unit}
									</span>
								</div>
								<input
									type="range"
									class={fx.compSlider}
									min={param.min}
									max={param.max}
									step={param.step}
									value={comp[param.key]}
									onInput={(e) =>
										updateVoiceCompressorParam(
											param.key,
											parseFloat((e.target as HTMLInputElement).value),
										)
									}
								/>
							</div>
						))}
					</div>
				</div>

				{compEnabled && (
					<div class={fx.reductionMeter}>
						<div class={fx.reductionLabel}>
							Gain Reduction: {reduction.toFixed(1)} dB
						</div>
						<div class={fx.reductionBar}>
							<div
								class={fx.reductionFill}
								style={{ width: `${Math.min(100, Math.abs(reduction) * 2)}%` }}
							/>
						</div>
					</div>
				)}

				<div class={fx.eqActions}>
					<ToggleButton onClick={resetVoiceCompressor}>Reset Compressor</ToggleButton>
					<ToggleButton pressed={visualizerOn} onClick={toggleVoiceCompressorVisualizer}>
						Visualize
					</ToggleButton>
					<ToggleButton pressed={compAutoOpen} onClick={toggleVoiceAutoCompControls}>
						Auto
					</ToggleButton>
				</div>

				{compAutoOpen && (
					<div class={fx.autoPanel}>
						<div class={fx.autoField}>
							<label class={fx.autoLabel} for="voiceAutoCompSeconds">
								Sample Secs
							</label>
							<input
								id="voiceAutoCompSeconds"
								type="number"
								min={1}
								max={10}
								step={1}
								value={voiceAutoCompSampleSeconds.value}
								disabled={compAutoRunning}
								onInput={(e) =>
									setVoiceAutoCompSampleSeconds(
										parseInt((e.target as HTMLInputElement).value, 10),
									)
								}
								class={fx.autoSeconds}
							/>
						</div>
						<div class={`${fx.autoField} ${fx.autoFieldFactor}`}>
							<label class={fx.autoLabel} for="voiceAutoCompFactor">
								Factor
								<span class={fx.autoValue}>
									{voiceAutoCompFactor.value.toFixed(1)}
								</span>
							</label>
							<input
								id="voiceAutoCompFactor"
								type="range"
								min={0.1}
								max={1}
								step={0.1}
								value={voiceAutoCompFactor.value}
								disabled={compAutoRunning}
								onInput={(e) =>
									setVoiceAutoCompFactor(
										parseFloat((e.target as HTMLInputElement).value),
									)
								}
								class={fx.autoFactorSlider}
							/>
						</div>
						<div class={fx.autoRunWrap}>
							<button
								type="button"
								class={fx.autoRunBtn}
								onClick={() => runVoiceAutoComp()}
								disabled={compAutoRunning}
								aria-label="Run voice auto-compressor sampler"
							>
								{compAutoRunning ? (
									<Spinner size="xs" />
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
			</div>
		</div>
	);
}

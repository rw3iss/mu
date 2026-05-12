import {
	activeVideoProfileId,
	loadVideoProfile,
	saveVideoProfile,
	updateVideoProfile,
} from '@/state/audio-profiles.state';
import {
	resetVideoEffects,
	toggleVideoEffects,
	updateVideoParam,
	type VideoEffectSettings,
	videoEffects,
	videoEnabled,
} from '@/state/video-effects.state';
import {
	setVideoEnhanceScale,
	setVideoEnhanceStrength,
	toggleVideoEnhance,
	videoEnhanceEnabled,
	videoEnhanceScale,
	videoEnhanceStrength,
	videoEnhanceSupported,
} from '@/state/video-enhance.state';
import styles from '../EffectsPanel.module.scss';
import { CollapsibleSettings } from './CollapsibleSettings';
import { ProfileControls } from './ProfileControls';

const VIDEO_PARAMS: {
	key: keyof VideoEffectSettings;
	label: string;
	min: number;
	max: number;
	step: number;
	unit: string;
	default: number;
}[] = [
	{ key: 'brightness', label: 'Brightness', min: 0, max: 200, step: 1, unit: '%', default: 100 },
	{ key: 'contrast', label: 'Contrast', min: 0, max: 200, step: 1, unit: '%', default: 100 },
	{ key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, unit: '%', default: 100 },
	{
		key: 'hueRotate',
		label: 'Hue Rotate',
		min: 0,
		max: 360,
		step: 1,
		unit: '°',
		default: 0,
	},
	{ key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, unit: '%', default: 0 },
	{ key: 'grayscale', label: 'Grayscale', min: 0, max: 100, step: 1, unit: '%', default: 0 },
	{
		key: 'verticalScale',
		label: 'Vertical Scale',
		min: 65,
		max: 135,
		step: 1,
		unit: '%',
		default: 100,
	},
	{ key: 'gamma', label: 'Gamma', min: 50, max: 200, step: 1, unit: '%', default: 100 },
	{
		key: 'blackLevel',
		label: 'Black Level',
		min: 0,
		max: 30,
		step: 1,
		unit: '%',
		default: 0,
	},
	{ key: 'crop', label: 'Crop', min: 100, max: 200, step: 1, unit: '%', default: 100 },
	{ key: 'sharpen', label: 'Sharpen', min: 0, max: 100, step: 1, unit: '%', default: 0 },
];

export function VideoTab() {
	const enabled = videoEnabled.value;
	const settings = videoEffects.value;
	const activeId = activeVideoProfileId.value;
	const enhanceOn = videoEnhanceEnabled.value;
	const enhanceStrength = videoEnhanceStrength.value;
	const enhanceScale = videoEnhanceScale.value;
	const gpuAvailable = videoEnhanceSupported.value;

	return (
		<div>
			{/* ── GPU Enhance (real-time upscaler) ── */}
			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>
					GPU Enhance
					<span
						class={styles.autoHelp}
						title={
							gpuAvailable
								? 'Runs the playing video through a GPU shader: bilinear upsample + 5-tap unsharp mask. Restores edge crispness on low-bitrate sources and makes 720p source look meaningfully better at 1080p+ output. Cost is per-frame GPU work — higher Output Resolution = more pixels = more work (quadratic). 1.5× at 1080p is safe on integrated GPUs; 2.0× wants a discrete GPU. Replaces the standard <video> rendering while active; the colour-grading sliders below do not apply.'
								: "Your browser doesn't expose WebGPU, which this effect needs. Try a current Chromium / Edge / Safari 17+ build."
						}
					>
						?
					</span>
				</span>
				<button
					class={`${styles.toggle} ${enhanceOn ? styles.on : ''}`}
					onClick={toggleVideoEnhance}
					disabled={!gpuAvailable}
					aria-label="Toggle GPU video enhancement"
				/>
			</div>

			{enhanceOn && gpuAvailable && (
				<CollapsibleSettings settingKey="effects_enhance_video_open">
					<div class={styles.compParam}>
						<div class={styles.compParamHeader}>
							<span class={styles.compParamLabel}>Sharpness</span>
							<span class={styles.compParamValue}>
								{Math.round(enhanceStrength * 100)}%
							</span>
						</div>
						<input
							type="range"
							class={styles.compSlider}
							min={0}
							max={1}
							step={0.01}
							value={enhanceStrength}
							onInput={(e) =>
								setVideoEnhanceStrength(
									parseFloat((e.target as HTMLInputElement).value),
								)
							}
						/>
					</div>

					<div class={styles.compParam}>
						<div class={styles.compParamHeader}>
							<span class={styles.compParamLabel}>
								Output Resolution
								<span
									class={styles.autoHelp}
									title="Multiplier on the source's native pixel count. 1.0× = same resolution (sharpen only). 1.5× = render to 1.5× width and height = 2.25× total pixels. 2.0× = 4× pixels = 4× GPU work. The shader still does the sharpening regardless of scale."
								>
									?
								</span>
							</span>
							<span class={styles.compParamValue}>{enhanceScale.toFixed(2)}×</span>
						</div>
						<input
							type="range"
							class={styles.compSlider}
							min={1}
							max={2.5}
							step={0.05}
							value={enhanceScale}
							onInput={(e) =>
								setVideoEnhanceScale(
									parseFloat((e.target as HTMLInputElement).value),
								)
							}
						/>
					</div>
				</CollapsibleSettings>
			)}

			{!gpuAvailable && (
				<div class={styles.emptyText}>
					Your browser doesn't support WebGPU. This effect is disabled.
				</div>
			)}

			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>Video Effects</span>
				<button
					class={`${styles.toggle} ${enabled ? styles.on : ''}`}
					onClick={toggleVideoEffects}
					aria-label="Toggle Video Effects"
				/>
			</div>

			<ProfileControls
				type="video"
				activeId={activeId}
				onLoad={loadVideoProfile}
				onSave={saveVideoProfile}
				onUpdate={updateVideoProfile}
			/>

			<CollapsibleSettings settingKey="effects_video_settings_open">
				{VIDEO_PARAMS.map((param) => (
					<div class={styles.compParam} key={param.key}>
						<div class={styles.compParamHeader}>
							<span class={styles.compParamLabel}>
								{param.label}
								{settings[param.key] !== param.default && (
									<button
										class={styles.paramResetBtn}
										onClick={() => updateVideoParam(param.key, param.default)}
										title={`Reset to ${param.default}${param.unit}`}
									>
										<svg
											width="10"
											height="10"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<polyline points="1 4 1 10 7 10" />
											<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
										</svg>
									</button>
								)}
							</span>
							<span class={styles.compParamValue}>
								{settings[param.key]}
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
							onDblClick={() => updateVideoParam(param.key, param.default)}
							onInput={(e) =>
								updateVideoParam(
									param.key,
									parseFloat((e.target as HTMLInputElement).value),
								)
							}
						/>
					</div>
				))}

				<button class={styles.resetBtn} onClick={resetVideoEffects}>
					Reset Video Effects
				</button>
			</CollapsibleSettings>
		</div>
	);
}

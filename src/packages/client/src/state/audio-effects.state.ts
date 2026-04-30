import { batch, signal } from '@preact/signals';
import {
	audioEngine,
	type CompressorSettings,
	DEFAULT_COMPRESSOR,
	DEFAULT_EQ_BANDS,
	type EqBand,
} from '@/audio/audio-engine';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import {
	activeCompProfileId,
	activeEqProfileId,
	activeVideoProfileId,
} from './audio-profiles.state';
import {
	DEFAULT_VIDEO_EFFECTS,
	type VideoEffectSettings,
	videoEffects,
	videoEnabled,
} from './video-effects.state';

/**
 * Audio effects state — EQ bands, input gain, compressor settings,
 * and the on/off + visualizer toggles for each. Profile management
 * lives in `audio-profiles.state` (so the file isn't a god-module),
 * and the unrelated video-effects state is in `video-effects.state`.
 *
 * For backward compatibility this module also re-exports the
 * splits' public API so existing call-sites keep importing from
 * `@/state/audio-effects.state` without churn.
 */

// ============================================
// Panel signals
// ============================================

export const showEffectsPanel = signal(false);
export const effectsTab = signal<'eq' | 'compressor' | 'video'>('eq');

// ============================================
// EQ
// ============================================

export const eqEnabled = signal(false);
export const eqInputGain = signal(0);
export const eqBands = signal<EqBand[]>(DEFAULT_EQ_BANDS.map((b) => ({ ...b })));
export const spectrumEnabled = signal(false);

// Auto-EQ — sample the live signal for N seconds, compute the average
// energy at each of the 10 EQ band frequencies, then drive each slider
// to (cross-band-mean − band) so the slider values sum to zero and the
// post-EQ output is roughly flat. Visible as an "Auto" pill toggle next
// to "Spectrum"; expanding it shows a seconds input + apply button.
export const autoEqOpen = signal(false);
export const autoEqSampleSeconds = signal(2);
export const autoEqRunning = signal(false);

// ============================================
// Compressor
// ============================================

export const compressorEnabled = signal(false);
export const compressorSettings = signal<CompressorSettings>({ ...DEFAULT_COMPRESSOR });
export const compressorVisualizerEnabled = signal(false);

// ============================================
// Initialization
// ============================================

export function initAudioEffects(): void {
	const savedEq = getUiSetting('audio_eq_enabled', false);
	const savedComp = getUiSetting('audio_compressor_enabled', false);
	const savedBands = getUiSetting<EqBand[] | null>('audio_eq_bands', null);
	const savedCompSettings = getUiSetting<CompressorSettings | null>(
		'audio_compressor_settings',
		null,
	);

	const savedInputGain = getUiSetting('audio_eq_input_gain', 0);
	const savedSpectrum = getUiSetting('audio_spectrum_enabled', false);
	const savedCompVisualizer = getUiSetting('audio_compressor_visualizer', false);

	// Apply to engine first
	if (savedBands) audioEngine.setBands(savedBands);
	if (savedCompSettings) audioEngine.setCompressorSettings(savedCompSettings);
	audioEngine.setEqEnabled(savedEq);
	audioEngine.setCompressorEnabled(savedComp);
	audioEngine.setInputGain(savedInputGain);
	if ((savedSpectrum || savedCompVisualizer) && !savedEq && !savedComp) {
		// Visualizers need the audio graph attached even if no effect is on
		// (the analyser node lives in the graph).
		audioEngine.attach();
	}

	const savedVideoEnabled = getUiSetting('video_effects_enabled', false);
	const savedVideoEffects = getUiSetting<VideoEffectSettings | null>(
		'video_effects_settings',
		null,
	);

	// Restore active profile IDs
	const savedEqProfileId = getUiSetting<string | null>('active_eq_profile_id', null);
	const savedCompProfileId = getUiSetting<string | null>('active_comp_profile_id', null);
	const savedVideoProfileId = getUiSetting<string | null>('active_video_profile_id', null);

	// Batch signal updates
	batch(() => {
		eqEnabled.value = savedEq;
		eqInputGain.value = savedInputGain;
		spectrumEnabled.value = savedSpectrum;
		compressorEnabled.value = savedComp;
		compressorVisualizerEnabled.value = savedCompVisualizer;
		if (savedBands) eqBands.value = savedBands;
		if (savedCompSettings) compressorSettings.value = savedCompSettings;
		videoEnabled.value = savedVideoEnabled;
		// Merge with defaults so old saved settings missing newer fields
		// (e.g. verticalScale) don't yield undefined → NaN at render time.
		if (savedVideoEffects) {
			videoEffects.value = { ...DEFAULT_VIDEO_EFFECTS, ...savedVideoEffects };
		}
		activeEqProfileId.value = savedEqProfileId;
		activeCompProfileId.value = savedCompProfileId;
		activeVideoProfileId.value = savedVideoProfileId;
	});
}

// ============================================
// Panel actions
// ============================================

export function toggleEffectsPanel(): void {
	showEffectsPanel.value = !showEffectsPanel.value;
}

export function closeEffectsPanel(): void {
	showEffectsPanel.value = false;
}

export function setEffectsTab(tab: 'eq' | 'compressor' | 'video'): void {
	effectsTab.value = tab;
}

// ============================================
// EQ actions
// ============================================

export function toggleEq(): void {
	const next = !eqEnabled.value;
	eqEnabled.value = next;
	audioEngine.setEqEnabled(next);
	setUiSetting('audio_eq_enabled', next);
}

export function toggleSpectrum(): void {
	const next = !spectrumEnabled.value;
	spectrumEnabled.value = next;
	if (next) {
		// Spectrum needs the analyser node, which is created on attach.
		audioEngine.attach();
	}
	setUiSetting('audio_spectrum_enabled', next);
}

export function updateInputGain(db: number): void {
	eqInputGain.value = db;
	audioEngine.setInputGain(db);
	setUiSetting('audio_eq_input_gain', db);
}

export function updateEqBand(index: number, gain: number): void {
	audioEngine.updateBand(index, gain);
	const bands = audioEngine.getBands();
	eqBands.value = bands;
	setUiSetting('audio_eq_bands', bands);
}

export function updateEqBandQ(index: number, q: number): void {
	audioEngine.updateBandQ(index, q);
	const bands = audioEngine.getBands();
	eqBands.value = bands;
	setUiSetting('audio_eq_bands', bands);
}

export function resetEq(): void {
	const freshBands = DEFAULT_EQ_BANDS.map((b) => ({ ...b }));
	audioEngine.setBands(freshBands);
	audioEngine.setInputGain(0);
	eqBands.value = freshBands;
	eqInputGain.value = 0;
	setUiSetting('audio_eq_bands', freshBands);
	setUiSetting('audio_eq_input_gain', 0);
}

// ============================================
// Auto-EQ actions
// ============================================

export function toggleAutoEqControls(): void {
	autoEqOpen.value = !autoEqOpen.value;
}

export function setAutoEqSampleSeconds(n: number): void {
	if (!Number.isFinite(n)) return;
	autoEqSampleSeconds.value = Math.max(1, Math.min(10, Math.floor(n)));
}

/**
 * Sample the live audio for `autoEqSampleSeconds` seconds, compute
 * the time-averaged magnitude at each of the 10 EQ band frequencies,
 * then drive each slider to `(cross-band-mean − band)` clamped to
 * the slider's ±12 dB range. By construction the slider values sum
 * to zero (each cut is balanced by an equal boost elsewhere), so the
 * EQ "flattens" the spectrum without changing the overall level.
 *
 * The analyser is tapped post-EQ in the audio graph, so we reset the
 * EQ bands to flat before sampling — that way the analyser sees the
 * unprocessed source signal and the corrections we compute aren't
 * compounded with whatever EQ shape was already in place.
 *
 * If EQ was off when invoked, it gets switched on as part of running
 * (otherwise the corrections we apply would be inaudible).
 */
export async function runAutoEq(): Promise<void> {
	if (autoEqRunning.value) return;
	autoEqRunning.value = true;
	try {
		const seconds = autoEqSampleSeconds.value;

		// Make sure the engine is attached and EQ is in a known flat
		// state so the post-EQ analyser sees the source signal directly.
		if (!eqEnabled.value) {
			eqEnabled.value = true;
			audioEngine.setEqEnabled(true);
			setUiSetting('audio_eq_enabled', true);
		}
		const flatBands = DEFAULT_EQ_BANDS.map((b) => ({ ...b }));
		audioEngine.setBands(flatBands);
		eqBands.value = flatBands;

		// One frame of breathing room so the disconnect/reconnect inside
		// rebuildChain settles before we start reading the analyser.
		await new Promise<void>((r) => setTimeout(r, 50));

		const fftSize = audioEngine.getFftSize() || 8192;
		const sampleRate = audioEngine.getSampleRate();
		const binCount = fftSize / 2;
		const binHz = sampleRate / fftSize;
		const buf = new Uint8Array(binCount);

		// Pre-compute, for each band, the FFT-bin window centred on its
		// frequency and bounded by the geometric midpoints with its
		// neighbours. Same approach as EqSpectrum's per-band bins.
		const eqFreqs = DEFAULT_EQ_BANDS.map((b) => b.frequency);
		const bandRanges = eqFreqs.map((f, i) => {
			const fLo = i === 0 ? f / Math.SQRT2 : Math.sqrt(f * eqFreqs[i - 1]!);
			const fHi = i === eqFreqs.length - 1 ? f * Math.SQRT2 : Math.sqrt(f * eqFreqs[i + 1]!);
			return {
				lo: Math.max(0, Math.round(fLo / binHz)),
				hi: Math.min(binCount - 1, Math.round(fHi / binHz)),
			};
		});

		// Accumulate per-band byte values across rAF ticks for the
		// requested duration, then average at the end.
		const accum = new Array<number>(eqFreqs.length).fill(0);
		let frames = 0;
		await new Promise<void>((resolve) => {
			const endTime = performance.now() + seconds * 1000;
			const tick = () => {
				if (performance.now() >= endTime) {
					resolve();
					return;
				}
				if (audioEngine.getFrequencyData(buf)) {
					for (let i = 0; i < eqFreqs.length; i++) {
						const { lo, hi } = bandRanges[i]!;
						let sum = 0;
						for (let b = lo; b <= hi; b++) sum += buf[b]!;
						accum[i]! += sum / (hi - lo + 1);
					}
					frames++;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});

		if (frames === 0) return; // analyser produced nothing — skip apply.

		// Convert byte (0..255) to approximate dBFS using the
		// AnalyserNode's default scale: 0 → -100 dB, 255 → -30 dB.
		const avgDb = accum.map((v) => (v / frames / 255) * 70 - 100);
		const meanDb = avgDb.reduce((a, b) => a + b, 0) / avgDb.length;
		// Each band: cut if it's louder than the mean, boost if quieter.
		// Clamp to slider range and round to the slider's 0.5 dB step.
		const offsets = avgDb.map((d) => {
			const raw = meanDb - d;
			const clamped = Math.max(-12, Math.min(12, raw));
			return Math.round(clamped * 2) / 2;
		});
		offsets.forEach((offset, i) => {
			updateEqBand(i, offset);
		});
	} finally {
		autoEqRunning.value = false;
	}
}

// ============================================
// Compressor actions
// ============================================

export function toggleCompressor(): void {
	const next = !compressorEnabled.value;
	compressorEnabled.value = next;
	audioEngine.setCompressorEnabled(next);
	setUiSetting('audio_compressor_enabled', next);
}

export function toggleCompressorVisualizer(): void {
	const next = !compressorVisualizerEnabled.value;
	compressorVisualizerEnabled.value = next;
	if (next) {
		// Visualizer reads input level from the analyser and the live
		// reduction value from the compressor — both live in the audio
		// graph, so we attach lazily here as the spectrum toggle does.
		audioEngine.attach();
	}
	setUiSetting('audio_compressor_visualizer', next);
}

export function updateCompressorParam<K extends keyof CompressorSettings>(
	key: K,
	value: CompressorSettings[K],
): void {
	const settings = { ...compressorSettings.value, [key]: value };
	compressorSettings.value = settings;
	audioEngine.setCompressorSettings(settings);
	setUiSetting('audio_compressor_settings', settings);
}

export function resetCompressor(): void {
	const freshSettings = { ...DEFAULT_COMPRESSOR };
	audioEngine.setCompressorSettings(freshSettings);
	compressorSettings.value = freshSettings;
	setUiSetting('audio_compressor_settings', freshSettings);
}

// ============================================
// Re-exports — backward compat for call-sites that still import from
// this module after the audio-profiles / video-effects split. New
// code should import from the focused modules directly.
// ============================================

export {
	activeCompProfileId,
	activeEqProfileId,
	activeProfileId,
	activeVideoProfileId,
	copyProfile,
	deleteProfile,
	fetchProfiles,
	loadCompProfile,
	loadEqProfile,
	loadProfile,
	loadVideoProfile,
	profiles,
	profilesLoading,
	saveCompProfile,
	saveEqProfile,
	saveProfile,
	saveVideoProfile,
	updateCompProfile,
	updateEqProfile,
	updateProfile,
	updateVideoProfile,
} from './audio-profiles.state';
export {
	DEFAULT_VIDEO_EFFECTS,
	resetVideoEffects,
	toggleVideoEffects,
	updateVideoParam,
	type VideoEffectSettings,
	videoEffects,
	videoEnabled,
} from './video-effects.state';

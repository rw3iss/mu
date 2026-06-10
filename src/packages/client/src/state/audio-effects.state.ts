import { batch, effect, signal } from '@preact/signals';
import {
	audioEngine,
	type CompressorBand,
	type CompressorSettings,
	DEFAULT_COMPRESSOR,
	DEFAULT_EQ_BANDS,
	DEFAULT_MULTIBAND,
	type EqBand,
	type MultiBandCompressorSettings,
} from '@/audio/audio-engine';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import {
	activeCompProfileId,
	activeEqProfileId,
	activeVideoProfileId,
} from './audio-profiles.state';
import { audioEffectsHlsBlocked, audioOutputSuspect, requestAudioReset } from './audio-reset.state';
import { notifyWarning } from './notifications.state';
import { whenUserGestured } from './user-gesture.state';

/**
 * If the engine has flagged the output as suspect (post-attach heuristic
 * or mid-session devicechange), warn the user the moment they try to
 * engage Web Audio — that's exactly when the stuck-sink bug would
 * silence them — with a one-click Reset Audio affordance.
 */
function warnIfAudioSuspect(): void {
	const state = audioOutputSuspect.value;
	if (!state.suspect) return;
	notifyWarning(
		`Audio output may be stuck (${state.reason ?? 'unknown reason'}). Enabling EQ/Compressor now may produce silence.`,
		10000,
		[
			{
				label: 'Reset Audio',
				onClick: () => {
					requestAudioReset();
				},
			},
		],
	);
}

/**
 * When the engine refuses to attach because the active stream is an HLS
 * MediaSource (Chrome silences createMediaElementSource on blob: srcs),
 * tell the user once — this covers the case where EQ was already enabled
 * from a previous session and the deferred attach fires on first gesture
 * (the toggle handler never runs, so we react to the engine's signal).
 * Throttled to one toast per false→true transition.
 */
let hlsBlockedNotified = false;
effect(() => {
	if (audioEffectsHlsBlocked.value) {
		if (hlsBlockedNotified) return;
		hlsBlockedNotified = true;
		notifyWarning(
			'EQ / Compressor aren’t available for transcoded (HLS) streams — a Chrome limitation silences Web Audio on them. Audio is playing normally on the native path. These effects work on direct-play files.',
			9000,
		);
	} else {
		hlsBlockedNotified = false;
	}
});
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
export const effectsTab = signal<'eq' | 'compressor' | 'enhance' | 'video'>('eq');

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
// Factor multiplier applied to each band's correction. 0.8 = strong
// flatten, 0.2 = mild correction (default — high strength tends to
// over-correct on dense source material), 0.05 = barely audible nudge.
export const autoEqFactor = signal(0.2);
export const autoEqRunning = signal(false);

// ============================================
// Compressor
// ============================================

export const compressorEnabled = signal(false);
export const compressorSettings = signal<CompressorSettings>({ ...DEFAULT_COMPRESSOR });
export const compressorVisualizerEnabled = signal(false);

// Multi-band: when enabled, the compressor stage uses three bands
// (low/mid/high) with their own compressors and crossover frequencies.
// `selectedBand` is the UI focus only — the engine processes all bands
// in parallel regardless.
export const multiBandEnabled = signal(false);
export const multiBandSettings = signal<MultiBandCompressorSettings>({
	low: { ...DEFAULT_MULTIBAND.low },
	mid: { ...DEFAULT_MULTIBAND.mid },
	high: { ...DEFAULT_MULTIBAND.high },
	lowCrossover: DEFAULT_MULTIBAND.lowCrossover,
	highCrossover: DEFAULT_MULTIBAND.highCrossover,
});
export const selectedBand = signal<CompressorBand>('mid');

// Auto-Compressor — sample the live signal for N seconds, measure peak
// and RMS levels, then derive sensible compressor settings (threshold
// at the midpoint of peak/RMS, ratio scaled by crest factor, makeup
// gain to compensate for the average loss). The factor multiplier
// blends from "no compression" (neutral) to the computed values, so
// 0.8 is close to the full derived settings but slightly gentler.
export const autoCompOpen = signal(false);
export const autoCompSampleSeconds = signal(2);
export const autoCompFactor = signal(0.8);
export const autoCompRunning = signal(false);

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

	// Enhancements
	const savedStereoWidthEnabled = getUiSetting('audio_stereo_width_enabled', false);
	const savedStereoWidthAmount = getUiSetting('audio_stereo_width_amount', 1.5);
	const savedBassEnhanceEnabled = getUiSetting('audio_bass_enhance_enabled', false);
	const savedBassEnhanceAmount = getUiSetting('audio_bass_enhance_amount', 0.4);
	const savedHrtfEnabled = getUiSetting('audio_hrtf_enabled', false);
	const savedHrtfAmount = getUiSetting('audio_hrtf_amount', 0.6);

	// Multi-band compressor
	const savedMultiBandEnabled = getUiSetting('audio_multiband_enabled', false);
	const savedMultiBandSettings = getUiSetting<MultiBandCompressorSettings | null>(
		'audio_multiband_settings',
		null,
	);
	const savedSelectedBand = getUiSetting<CompressorBand>('audio_multiband_selected_band', 'mid');

	// Apply non-attaching settings immediately — these are pure parameter
	// stores on the engine and don't create the AudioContext.
	if (savedBands) audioEngine.setBands(savedBands);
	if (savedCompSettings) audioEngine.setCompressorSettings(savedCompSettings);
	audioEngine.setInputGain(savedInputGain);
	audioEngine.setStereoWidthAmount(savedStereoWidthAmount);
	audioEngine.setBassEnhanceAmount(savedBassEnhanceAmount);
	audioEngine.setHrtfAmount(savedHrtfAmount);
	if (savedMultiBandSettings) {
		audioEngine.setBandCrossovers(
			savedMultiBandSettings.lowCrossover,
			savedMultiBandSettings.highCrossover,
		);
		audioEngine.setBandCompressorSettings('low', savedMultiBandSettings.low);
		audioEngine.setBandCompressorSettings('mid', savedMultiBandSettings.mid);
		audioEngine.setBandCompressorSettings('high', savedMultiBandSettings.high);
	}

	// Defer the enable-flag application until the user has actually
	// interacted with the page. Each set*Enabled(true) call triggers
	// audioEngine.attach() → createMediaElementSource → permanently
	// binds the <video>'s audio into the Web Audio graph. We need a
	// real user-gesture frame for AudioContext.resume() to succeed,
	// otherwise the source is bound to a suspended ctx and audio is
	// silent until the next click. whenUserGestured() either runs
	// the callback immediately if the user has already gestured, or
	// queues it to fire inside the next gesture handler.
	whenUserGestured(() => {
		audioEngine.setEqEnabled(savedEq);
		audioEngine.setCompressorEnabled(savedComp);
		audioEngine.setStereoWidthEnabled(savedStereoWidthEnabled);
		audioEngine.setBassEnhanceEnabled(savedBassEnhanceEnabled);
		audioEngine.setHrtfEnabled(savedHrtfEnabled);
		audioEngine.setMultiBandEnabled(savedMultiBandEnabled);
	});

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
		stereoWidthEnabled.value = savedStereoWidthEnabled;
		stereoWidthAmount.value = savedStereoWidthAmount;
		bassEnhanceEnabled.value = savedBassEnhanceEnabled;
		bassEnhanceAmount.value = savedBassEnhanceAmount;
		hrtfSurroundEnabled.value = savedHrtfEnabled;
		hrtfSurroundAmount.value = savedHrtfAmount;
		multiBandEnabled.value = savedMultiBandEnabled;
		if (savedMultiBandSettings) multiBandSettings.value = savedMultiBandSettings;
		selectedBand.value = savedSelectedBand;
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

export function setEffectsTab(tab: 'eq' | 'compressor' | 'enhance' | 'video'): void {
	effectsTab.value = tab;
}

// ============================================
// Enhancements (stereo widening, bass enhance, HRTF surround)
// ============================================

export const stereoWidthEnabled = signal(false);
export const stereoWidthAmount = signal(1.5);
export const bassEnhanceEnabled = signal(false);
export const bassEnhanceAmount = signal(0.4);
export const hrtfSurroundEnabled = signal(false);
export const hrtfSurroundAmount = signal(0.6);

export function toggleStereoWidth(): void {
	const next = !stereoWidthEnabled.value;
	stereoWidthEnabled.value = next;
	audioEngine.setStereoWidthEnabled(next);
	setUiSetting('audio_stereo_width_enabled', next);
}
export function setStereoWidthAmount(amount: number): void {
	const clamped = Math.max(0, Math.min(2, amount));
	stereoWidthAmount.value = clamped;
	audioEngine.setStereoWidthAmount(clamped);
	setUiSetting('audio_stereo_width_amount', clamped);
}

export function toggleBassEnhance(): void {
	const next = !bassEnhanceEnabled.value;
	bassEnhanceEnabled.value = next;
	audioEngine.setBassEnhanceEnabled(next);
	setUiSetting('audio_bass_enhance_enabled', next);
}
export function setBassEnhanceAmount(amount: number): void {
	const clamped = Math.max(0, Math.min(1, amount));
	bassEnhanceAmount.value = clamped;
	audioEngine.setBassEnhanceAmount(clamped);
	setUiSetting('audio_bass_enhance_amount', clamped);
}

export function toggleHrtfSurround(): void {
	const next = !hrtfSurroundEnabled.value;
	hrtfSurroundEnabled.value = next;
	audioEngine.setHrtfEnabled(next);
	setUiSetting('audio_hrtf_enabled', next);
}
export function setHrtfSurroundAmount(amount: number): void {
	const clamped = Math.max(0, Math.min(1, amount));
	hrtfSurroundAmount.value = clamped;
	audioEngine.setHrtfAmount(clamped);
	setUiSetting('audio_hrtf_amount', clamped);
}

// ============================================
// EQ actions
// ============================================

export function toggleEq(): void {
	const next = !eqEnabled.value;
	if (next) warnIfAudioSuspect();
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

export function setAutoEqFactor(n: number): void {
	if (!Number.isFinite(n)) return;
	// Clamp to 0.05..0.8 in 0.05 increments (the slider's resolution).
	const clamped = Math.max(0.05, Math.min(0.8, n));
	autoEqFactor.value = Math.round(clamped * 20) / 20;
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
		// Scale by `autoEqFactor` so the user can dial down the strength
		// of the correction (default 0.5 — full-strength flattening tends
		// to over-correct on dense source material). Clamp to slider
		// range and round to the slider's 0.5 dB step.
		const factor = autoEqFactor.value;
		const offsets = avgDb.map((d) => {
			const raw = (meanDb - d) * factor;
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
	if (next) warnIfAudioSuspect();
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
// Multi-band compressor actions
// ============================================

export function toggleMultiBand(): void {
	const next = !multiBandEnabled.value;
	multiBandEnabled.value = next;
	audioEngine.setMultiBandEnabled(next);
	setUiSetting('audio_multiband_enabled', next);
}

export function setSelectedBand(band: CompressorBand): void {
	selectedBand.value = band;
	setUiSetting('audio_multiband_selected_band', band);
}

export function updateBandCompressorParam<K extends keyof CompressorSettings>(
	band: CompressorBand,
	key: K,
	value: CompressorSettings[K],
): void {
	const current = multiBandSettings.value;
	const updatedBand = { ...current[band], [key]: value };
	const next: MultiBandCompressorSettings = { ...current, [band]: updatedBand };
	multiBandSettings.value = next;
	audioEngine.setBandCompressorSettings(band, updatedBand);
	setUiSetting('audio_multiband_settings', next);
}

export function setBandCrossover(which: 'low' | 'high', freq: number): void {
	const current = multiBandSettings.value;
	const next: MultiBandCompressorSettings = {
		...current,
		[which === 'low' ? 'lowCrossover' : 'highCrossover']: freq,
	};
	// Engine clamps + keeps low<high, so re-read after applying.
	audioEngine.setBandCrossovers(next.lowCrossover, next.highCrossover);
	const applied = audioEngine.getBandCrossovers();
	const synced: MultiBandCompressorSettings = {
		...next,
		lowCrossover: applied.low,
		highCrossover: applied.high,
	};
	multiBandSettings.value = synced;
	setUiSetting('audio_multiband_settings', synced);
}

export function resetMultiBand(): void {
	const fresh: MultiBandCompressorSettings = {
		low: { ...DEFAULT_MULTIBAND.low },
		mid: { ...DEFAULT_MULTIBAND.mid },
		high: { ...DEFAULT_MULTIBAND.high },
		lowCrossover: DEFAULT_MULTIBAND.lowCrossover,
		highCrossover: DEFAULT_MULTIBAND.highCrossover,
	};
	multiBandSettings.value = fresh;
	audioEngine.setBandCrossovers(fresh.lowCrossover, fresh.highCrossover);
	audioEngine.setBandCompressorSettings('low', fresh.low);
	audioEngine.setBandCompressorSettings('mid', fresh.mid);
	audioEngine.setBandCompressorSettings('high', fresh.high);
	setUiSetting('audio_multiband_settings', fresh);
}

/**
 * Multi-band variant of runAutoComp. Samples the live signal for the
 * configured duration, integrates time-domain energy within each
 * band's frequency range from the FFT analyser, derives ideal
 * threshold/ratio/makeup per-band, and applies factor-blended
 * settings to all three bands at once.
 */
export async function runAutoMultiBandComp(): Promise<void> {
	if (autoCompRunning.value) return;
	autoCompRunning.value = true;
	try {
		const seconds = autoCompSampleSeconds.value;
		const factor = autoCompFactor.value;
		const settings = multiBandSettings.value;

		audioEngine.attach();
		await new Promise<void>((r) => setTimeout(r, 50));

		const fftSize = audioEngine.getFftSize() || 8192;
		const sampleRate = audioEngine.getSampleRate();
		const binCount = fftSize / 2;
		const binHz = sampleRate / fftSize;
		const buf = new Uint8Array(binCount);

		// FFT bin ranges for each band based on the configured crossovers.
		const lo = settings.lowCrossover;
		const hi = settings.highCrossover;
		const ranges: Record<CompressorBand, { lo: number; hi: number }> = {
			low: { lo: 0, hi: Math.min(binCount - 1, Math.round(lo / binHz)) },
			mid: {
				lo: Math.min(binCount - 1, Math.round(lo / binHz)),
				hi: Math.min(binCount - 1, Math.round(hi / binHz)),
			},
			high: {
				lo: Math.min(binCount - 1, Math.round(hi / binHz)),
				hi: binCount - 1,
			},
		};

		const sums: Record<CompressorBand, number> = { low: 0, mid: 0, high: 0 };
		const peaks: Record<CompressorBand, number> = { low: 0, mid: 0, high: 0 };
		let frames = 0;
		await new Promise<void>((resolve) => {
			const endTime = performance.now() + seconds * 1000;
			const tick = () => {
				if (performance.now() >= endTime) {
					resolve();
					return;
				}
				if (audioEngine.getFrequencyData(buf)) {
					for (const band of ['low', 'mid', 'high'] as CompressorBand[]) {
						const r = ranges[band];
						let sum = 0;
						let peak = 0;
						for (let b = r.lo; b <= r.hi; b++) {
							const v = buf[b]!;
							sum += v;
							if (v > peak) peak = v;
						}
						sums[band] += sum / Math.max(1, r.hi - r.lo + 1);
						if (peak > peaks[band]) peaks[band] = peak;
					}
					frames++;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});

		if (frames === 0) return;

		const FLOOR_DB = -60;
		const next: MultiBandCompressorSettings = {
			...settings,
		};
		for (const band of ['low', 'mid', 'high'] as CompressorBand[]) {
			// Convert byte (0..255) to approximate dBFS using the analyser's
			// default scale: 0 → -100 dB, 255 → -30 dB.
			const avgByte = sums[band] / frames;
			const peakByte = peaks[band];
			const rmsDb = Math.max(FLOOR_DB, (avgByte / 255) * 70 - 100);
			const peakDb = Math.max(FLOOR_DB, (peakByte / 255) * 70 - 100);
			const crest = peakDb - rmsDb;

			// Bias threshold toward RMS so more of the signal lands above it.
			// Ratio table is steeper than a 4-stop comp because we're going
			// for perceived loudness, not transparent dynamics. Makeup adds
			// 1.5× the peak-loss to compensate for the bulk of the signal
			// (which sits near RMS, not at the peaks).
			const idealThreshold = rmsDb + (peakDb - rmsDb) * 0.25;
			const idealRatio = crest < 6 ? 3 : crest < 10 ? 6 : crest < 15 ? 10 : 14;
			const idealMakeup = Math.max(0, (peakDb - idealThreshold) * (1 - 1 / idealRatio) * 1.5);

			const newThreshold = factor * idealThreshold;
			const newRatio = 1 + factor * (idealRatio - 1);
			const newMakeup = factor * idealMakeup;

			const bandSettings: CompressorSettings = {
				...settings[band],
				threshold: Math.max(-100, Math.min(0, Math.round(newThreshold))),
				knee: 30,
				ratio: Math.max(1, Math.min(20, Math.round(newRatio * 2) / 2)),
				attack: 0.005,
				release: 0.2,
				makeupGain: Math.max(0, Math.min(24, Math.round(newMakeup * 2) / 2)),
				mix: settings[band].mix ?? 1,
			};
			next[band] = bandSettings;
			audioEngine.setBandCompressorSettings(band, bandSettings);
		}
		multiBandSettings.value = next;
		setUiSetting('audio_multiband_settings', next);

		// Make sure the compressor stage is on so the user hears the result.
		if (!compressorEnabled.value) {
			compressorEnabled.value = true;
			audioEngine.setCompressorEnabled(true);
			setUiSetting('audio_compressor_enabled', true);
		}
	} finally {
		autoCompRunning.value = false;
	}
}

// ============================================
// Auto-Compressor actions
// ============================================

export function toggleAutoCompControls(): void {
	autoCompOpen.value = !autoCompOpen.value;
}

export function setAutoCompSampleSeconds(n: number): void {
	if (!Number.isFinite(n)) return;
	autoCompSampleSeconds.value = Math.max(1, Math.min(10, Math.floor(n)));
}

export function setAutoCompFactor(n: number): void {
	if (!Number.isFinite(n)) return;
	const clamped = Math.max(0.1, Math.min(1, n));
	autoCompFactor.value = Math.round(clamped * 10) / 10;
}

/**
 * Sample the live audio for `autoCompSampleSeconds` seconds, measure
 * peak and RMS levels in dBFS, then derive a sensible compressor
 * setting:
 *
 *   - threshold = midpoint between peak and RMS (compress everything
 *     louder than the average of the two)
 *   - ratio scaled by crest factor (peak − RMS): low crest = already
 *     compressed material → low ratio; high crest = dynamic source
 *     → higher ratio
 *   - makeupGain ≈ the loss the new threshold + ratio will introduce
 *     for the loudest peaks, so the average level is preserved
 *   - knee, attack, release, mix held to musical defaults
 *
 * The `autoCompFactor` then blends linearly from neutral (no
 * compression: threshold 0, ratio 1, makeup 0) to the computed
 * values. At factor=1.0 you get the full derived setting, at
 * factor=0.5 you get half-strength compression that lifts dynamics
 * without squashing them.
 *
 * The analyser is tapped post-EQ but pre-compressor in our chain,
 * so we don't need to bypass the compressor first — the analyser
 * already sees source-level dynamics regardless of the current
 * compressor state.
 */
export async function runAutoComp(): Promise<void> {
	if (autoCompRunning.value) return;
	autoCompRunning.value = true;
	try {
		const seconds = autoCompSampleSeconds.value;
		const factor = autoCompFactor.value;

		// Make sure the engine is attached so the analyser node exists.
		audioEngine.attach();
		await new Promise<void>((r) => setTimeout(r, 50));

		const fftSize = audioEngine.getFftSize() || 8192;
		const buf = new Uint8Array(fftSize);

		let peakAbs = 0;
		let sumSq = 0;
		let totalSamples = 0;
		await new Promise<void>((resolve) => {
			const endTime = performance.now() + seconds * 1000;
			const tick = () => {
				if (performance.now() >= endTime) {
					resolve();
					return;
				}
				if (audioEngine.getTimeDomainData(buf)) {
					for (let i = 0; i < buf.length; i++) {
						// Map byte 0..255 to amplitude −1..+1 (128 = silence).
						const v = (buf[i]! - 128) / 128;
						const abs = Math.abs(v);
						if (abs > peakAbs) peakAbs = abs;
						sumSq += v * v;
					}
					totalSamples += buf.length;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});

		if (totalSamples === 0 || peakAbs === 0) return;

		const FLOOR_DB = -60;
		const peakDb = Math.max(FLOOR_DB, 20 * Math.log10(peakAbs));
		const rms = Math.sqrt(sumSq / totalSamples);
		const rmsDb = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB;
		const crest = peakDb - rmsDb;

		// Ideal settings derived from the measured dynamics. Biased
		// toward perceived loudness (vs transparent dynamics): threshold
		// is pulled toward RMS so more of the signal compresses, the
		// ratio table is steeper, and makeup is 1.5× the peak-loss to
		// compensate for the bulk of the signal sitting at RMS — not
		// just at the peaks.
		const idealThreshold = rmsDb + (peakDb - rmsDb) * 0.25;
		const idealRatio = crest < 6 ? 3 : crest < 10 ? 6 : crest < 15 ? 10 : 14;
		const idealMakeup = Math.max(0, (peakDb - idealThreshold) * (1 - 1 / idealRatio) * 1.5);

		// Linear interpolate from neutral (no compression) to the ideal
		// values by the factor multiplier.
		const newThreshold = factor * idealThreshold;
		const newRatio = 1 + factor * (idealRatio - 1);
		const newMakeup = factor * idealMakeup;

		const settings: CompressorSettings = {
			...compressorSettings.value,
			threshold: Math.max(-100, Math.min(0, Math.round(newThreshold))),
			knee: 30,
			ratio: Math.max(1, Math.min(20, Math.round(newRatio * 2) / 2)),
			attack: 0.005,
			release: 0.2,
			makeupGain: Math.max(0, Math.min(24, Math.round(newMakeup * 2) / 2)),
			mix: compressorSettings.value.mix ?? 1,
		};

		compressorSettings.value = settings;
		audioEngine.setCompressorSettings(settings);
		setUiSetting('audio_compressor_settings', settings);

		// Make the new settings audible — switch the compressor on if
		// the user hadn't enabled it yet (otherwise the slider changes
		// would be a no-op for them).
		if (!compressorEnabled.value) {
			compressorEnabled.value = true;
			audioEngine.setCompressorEnabled(true);
			setUiSetting('audio_compressor_enabled', true);
		}
	} finally {
		autoCompRunning.value = false;
	}
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

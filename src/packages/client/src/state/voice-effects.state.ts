import { batch, signal } from '@preact/signals';
import {
	type CompressorSettings,
	DEFAULT_COMPRESSOR,
	DEFAULT_EQ_BANDS,
	type EqBand,
} from '@/audio/audio-engine';
import { micAudioEngine } from '@/audio/mic-audio-engine';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';

/**
 * Voice (microphone) effects state — the EQ / compressor / auto controls for
 * the Shared Sessions voice input. Mirrors `audio-effects.state.ts` but drives
 * the {@link micAudioEngine} instead of the playback `audioEngine`, and
 * persists under `voice_*` UI keys so it's independent of the movie effects.
 *
 * These are pure parameter stores + the mic engine's analyser — they never
 * touch playback. When there is no active voice session they are simply unused.
 */

// ── Panel + tabs ──
export const voiceEqEnabled = signal(false);
export const voiceEqInputGain = signal(0);
export const voiceEqBands = signal<EqBand[]>(DEFAULT_EQ_BANDS.map((b) => ({ ...b })));
export const voiceSpectrumEnabled = signal(false);

export const voiceCompressorEnabled = signal(false);
export const voiceCompressorSettings = signal<CompressorSettings>({ ...DEFAULT_COMPRESSOR });
export const voiceCompressorVisualizerEnabled = signal(false);

// Auto-EQ / Auto-Comp (same UX as playback effects).
export const voiceAutoEqOpen = signal(false);
export const voiceAutoEqSampleSeconds = signal(2);
export const voiceAutoEqFactor = signal(0.2);
export const voiceAutoEqRunning = signal(false);

export const voiceAutoCompOpen = signal(false);
export const voiceAutoCompSampleSeconds = signal(2);
export const voiceAutoCompFactor = signal(0.8);
export const voiceAutoCompRunning = signal(false);

// ── Init / restore ──

let initialized = false;

/** Restore persisted voice-effect settings into signals + the mic engine. */
export function initVoiceEffects(): void {
	if (initialized) return;
	initialized = true;

	const savedEq = getUiSetting('voice_eq_enabled', false);
	const savedComp = getUiSetting('voice_compressor_enabled', false);
	const savedBands = getUiSetting<EqBand[] | null>('voice_eq_bands', null);
	const savedCompSettings = getUiSetting<CompressorSettings | null>(
		'voice_compressor_settings',
		null,
	);
	const savedInputGain = getUiSetting('voice_eq_input_gain', 0);
	const savedSpectrum = getUiSetting('voice_spectrum_enabled', false);
	const savedCompVisualizer = getUiSetting('voice_compressor_visualizer', false);
	const savedAutoEqFactor = getUiSetting('voice_auto_eq_factor', 0.2);
	const savedAutoCompFactor = getUiSetting('voice_auto_comp_factor', 0.8);

	if (savedBands) micAudioEngine.setBands(savedBands);
	if (savedCompSettings) micAudioEngine.setCompressorSettings(savedCompSettings);
	micAudioEngine.setInputGain(savedInputGain);
	micAudioEngine.setEqEnabled(savedEq);
	micAudioEngine.setCompressorEnabled(savedComp);

	batch(() => {
		voiceEqEnabled.value = savedEq;
		voiceEqInputGain.value = savedInputGain;
		voiceSpectrumEnabled.value = savedSpectrum;
		voiceCompressorEnabled.value = savedComp;
		voiceCompressorVisualizerEnabled.value = savedCompVisualizer;
		voiceAutoEqFactor.value = savedAutoEqFactor;
		voiceAutoCompFactor.value = savedAutoCompFactor;
		if (savedBands) voiceEqBands.value = savedBands;
		if (savedCompSettings) voiceCompressorSettings.value = savedCompSettings;
	});
}

// ── EQ actions ──

export function toggleVoiceEq(): void {
	const next = !voiceEqEnabled.value;
	voiceEqEnabled.value = next;
	micAudioEngine.setEqEnabled(next);
	setUiSetting('voice_eq_enabled', next);
}

export function toggleVoiceSpectrum(): void {
	const next = !voiceSpectrumEnabled.value;
	voiceSpectrumEnabled.value = next;
	setUiSetting('voice_spectrum_enabled', next);
}

export function updateVoiceInputGain(db: number): void {
	voiceEqInputGain.value = db;
	micAudioEngine.setInputGain(db);
	setUiSetting('voice_eq_input_gain', db);
}

export function updateVoiceEqBand(index: number, gain: number): void {
	micAudioEngine.updateBand(index, gain);
	const bands = micAudioEngine.getBands();
	voiceEqBands.value = bands;
	setUiSetting('voice_eq_bands', bands);
}

export function updateVoiceEqBandQ(index: number, q: number): void {
	micAudioEngine.updateBandQ(index, q);
	const bands = micAudioEngine.getBands();
	voiceEqBands.value = bands;
	setUiSetting('voice_eq_bands', bands);
}

export function resetVoiceEq(): void {
	const freshBands = DEFAULT_EQ_BANDS.map((b) => ({ ...b }));
	micAudioEngine.setBands(freshBands);
	micAudioEngine.setInputGain(0);
	voiceEqBands.value = freshBands;
	voiceEqInputGain.value = 0;
	setUiSetting('voice_eq_bands', freshBands);
	setUiSetting('voice_eq_input_gain', 0);
}

// ── Compressor actions ──

export function toggleVoiceCompressor(): void {
	const next = !voiceCompressorEnabled.value;
	voiceCompressorEnabled.value = next;
	micAudioEngine.setCompressorEnabled(next);
	setUiSetting('voice_compressor_enabled', next);
}

export function toggleVoiceCompressorVisualizer(): void {
	const next = !voiceCompressorVisualizerEnabled.value;
	voiceCompressorVisualizerEnabled.value = next;
	setUiSetting('voice_compressor_visualizer', next);
}

export function updateVoiceCompressorParam<K extends keyof CompressorSettings>(
	key: K,
	value: CompressorSettings[K],
): void {
	const settings = { ...voiceCompressorSettings.value, [key]: value };
	voiceCompressorSettings.value = settings;
	micAudioEngine.setCompressorSettings(settings);
	setUiSetting('voice_compressor_settings', settings);
}

export function resetVoiceCompressor(): void {
	const fresh = { ...DEFAULT_COMPRESSOR };
	micAudioEngine.setCompressorSettings(fresh);
	voiceCompressorSettings.value = fresh;
	setUiSetting('voice_compressor_settings', fresh);
}

// ── Auto controls ──

export function toggleVoiceAutoEqControls(): void {
	voiceAutoEqOpen.value = !voiceAutoEqOpen.value;
}
export function setVoiceAutoEqSampleSeconds(n: number): void {
	if (!Number.isFinite(n)) return;
	voiceAutoEqSampleSeconds.value = Math.max(1, Math.min(10, Math.floor(n)));
}
export function setVoiceAutoEqFactor(n: number): void {
	if (!Number.isFinite(n)) return;
	const clamped = Math.max(0.05, Math.min(0.8, n));
	voiceAutoEqFactor.value = Math.round(clamped * 20) / 20;
	setUiSetting('voice_auto_eq_factor', voiceAutoEqFactor.value);
}

export function toggleVoiceAutoCompControls(): void {
	voiceAutoCompOpen.value = !voiceAutoCompOpen.value;
}
export function setVoiceAutoCompSampleSeconds(n: number): void {
	if (!Number.isFinite(n)) return;
	voiceAutoCompSampleSeconds.value = Math.max(1, Math.min(10, Math.floor(n)));
}
export function setVoiceAutoCompFactor(n: number): void {
	if (!Number.isFinite(n)) return;
	const clamped = Math.max(0.1, Math.min(1, n));
	voiceAutoCompFactor.value = Math.round(clamped * 10) / 10;
	setUiSetting('voice_auto_comp_factor', voiceAutoCompFactor.value);
}

/**
 * Sample the live mic signal for `voiceAutoEqSampleSeconds`, compute the
 * time-averaged magnitude at each of the 10 EQ band frequencies, then drive
 * each slider to `(cross-band-mean − band) × factor` so the response flattens
 * without changing the overall level. Mirrors the playback runAutoEq.
 */
export async function runVoiceAutoEq(): Promise<void> {
	if (voiceAutoEqRunning.value) return;
	voiceAutoEqRunning.value = true;
	try {
		const seconds = voiceAutoEqSampleSeconds.value;
		if (!voiceEqEnabled.value) {
			voiceEqEnabled.value = true;
			micAudioEngine.setEqEnabled(true);
			setUiSetting('voice_eq_enabled', true);
		}
		const flatBands = DEFAULT_EQ_BANDS.map((b) => ({ ...b }));
		micAudioEngine.setBands(flatBands);
		voiceEqBands.value = flatBands;
		await new Promise<void>((r) => setTimeout(r, 50));

		const fftSize = micAudioEngine.getFftSize() || 8192;
		const sampleRate = micAudioEngine.getSampleRate();
		const binCount = fftSize / 2;
		const binHz = sampleRate / fftSize;
		const buf = new Uint8Array(binCount);

		const eqFreqs = DEFAULT_EQ_BANDS.map((b) => b.frequency);
		const bandRanges = eqFreqs.map((f, i) => {
			const fLo = i === 0 ? f / Math.SQRT2 : Math.sqrt(f * eqFreqs[i - 1]!);
			const fHi = i === eqFreqs.length - 1 ? f * Math.SQRT2 : Math.sqrt(f * eqFreqs[i + 1]!);
			return {
				lo: Math.max(0, Math.round(fLo / binHz)),
				hi: Math.min(binCount - 1, Math.round(fHi / binHz)),
			};
		});

		const accum = new Array<number>(eqFreqs.length).fill(0);
		let frames = 0;
		await new Promise<void>((resolve) => {
			const endTime = performance.now() + seconds * 1000;
			const tick = () => {
				if (performance.now() >= endTime) {
					resolve();
					return;
				}
				if (micAudioEngine.getFrequencyData(buf)) {
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
		if (frames === 0) return;

		const avgDb = accum.map((v) => (v / frames / 255) * 70 - 100);
		const meanDb = avgDb.reduce((a, b) => a + b, 0) / avgDb.length;
		const factor = voiceAutoEqFactor.value;
		const offsets = avgDb.map((d) => {
			const raw = (meanDb - d) * factor;
			const clamped = Math.max(-12, Math.min(12, raw));
			return Math.round(clamped * 2) / 2;
		});
		offsets.forEach((offset, i) => {
			updateVoiceEqBand(i, offset);
		});
	} finally {
		voiceAutoEqRunning.value = false;
	}
}

/**
 * Sample the live mic signal, measure peak + RMS, and derive compressor
 * settings blended by `voiceAutoCompFactor` from neutral to ideal. Mirrors the
 * playback runAutoComp.
 */
export async function runVoiceAutoComp(): Promise<void> {
	if (voiceAutoCompRunning.value) return;
	voiceAutoCompRunning.value = true;
	try {
		const seconds = voiceAutoCompSampleSeconds.value;
		const factor = voiceAutoCompFactor.value;
		await new Promise<void>((r) => setTimeout(r, 50));

		const fftSize = micAudioEngine.getFftSize() || 8192;
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
				if (micAudioEngine.getTimeDomainData(buf)) {
					for (let i = 0; i < buf.length; i++) {
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

		const idealThreshold = rmsDb + (peakDb - rmsDb) * 0.25;
		const idealRatio = crest < 6 ? 3 : crest < 10 ? 6 : crest < 15 ? 10 : 14;
		const idealMakeup = Math.max(0, (peakDb - idealThreshold) * (1 - 1 / idealRatio) * 1.5);

		const settings: CompressorSettings = {
			...voiceCompressorSettings.value,
			threshold: Math.max(-100, Math.min(0, Math.round(factor * idealThreshold))),
			knee: 30,
			ratio: Math.max(1, Math.min(20, Math.round((1 + factor * (idealRatio - 1)) * 2) / 2)),
			attack: 0.005,
			release: 0.2,
			makeupGain: Math.max(0, Math.min(24, Math.round(factor * idealMakeup * 2) / 2)),
			mix: voiceCompressorSettings.value.mix ?? 1,
		};

		voiceCompressorSettings.value = settings;
		micAudioEngine.setCompressorSettings(settings);
		setUiSetting('voice_compressor_settings', settings);
		if (!voiceCompressorEnabled.value) {
			voiceCompressorEnabled.value = true;
			micAudioEngine.setCompressorEnabled(true);
			setUiSetting('voice_compressor_enabled', true);
		}
	} finally {
		voiceAutoCompRunning.value = false;
	}
}

import { debug } from 'dev-loggers';
import {
	audioEffectsHlsBlocked,
	clearAudioSuspect,
	markAudioSuspect,
	requestAudioReset,
} from '@/state/audio-reset.state';

/**
 * Audio processing engine using Web Audio API.
 *
 * Chain when fully active:
 *   MediaElementSource
 *     → InputGain
 *     → EQ filters (10-band)
 *     → Compressor (single- or multi-band, w/ dry/wet mix)
 *     → Stereo Width (M/S processing)
 *     → Bass Enhance (low-shelf + waveshaper saturation)
 *     → HRTF Surround (Panner-based)
 *     → Destination
 *
 * Each stage is independently bypassable; when all are off the source
 * connects directly to the destination (zero-overhead pass-through).
 */

export interface EqBand {
	frequency: number;
	gain: number;
	q: number;
	type: BiquadFilterType;
}

export interface CompressorSettings {
	threshold: number;
	knee: number;
	ratio: number;
	attack: number;
	release: number;
	makeupGain: number;
	/** Dry/wet mix: 0 = fully dry (bypass), 1 = fully wet (compressed). Default 1. */
	mix: number;
}

export const DEFAULT_EQ_BANDS: EqBand[] = [
	{ frequency: 32, gain: 0, q: 1.0, type: 'lowshelf' },
	{ frequency: 64, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 125, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 250, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 500, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 1000, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 2000, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 4000, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 8000, gain: 0, q: 1.0, type: 'peaking' },
	{ frequency: 16000, gain: 0, q: 1.0, type: 'highshelf' },
];

export const DEFAULT_COMPRESSOR: CompressorSettings = {
	threshold: -24,
	knee: 30,
	ratio: 12,
	attack: 0.003,
	release: 0.25,
	makeupGain: 0,
	mix: 1,
};

export type CompressorBand = 'low' | 'mid' | 'high';

export interface MultiBandCompressorSettings {
	low: CompressorSettings;
	mid: CompressorSettings;
	high: CompressorSettings;
	/** Low/mid crossover frequency, in Hz. */
	lowCrossover: number;
	/** Mid/high crossover frequency, in Hz. */
	highCrossover: number;
}

export const DEFAULT_MULTIBAND: MultiBandCompressorSettings = {
	low: { ...DEFAULT_COMPRESSOR, threshold: -28, ratio: 4, makeupGain: 2 },
	mid: { ...DEFAULT_COMPRESSOR, threshold: -22, ratio: 3, makeupGain: 0 },
	high: { ...DEFAULT_COMPRESSOR, threshold: -22, ratio: 3, makeupGain: 0 },
	lowCrossover: 250,
	highCrossover: 4000,
};

/**
 * Minimum wet-gain when the compressor is enabled. Web Audio (Chrome) will
 * cull processing of upstream nodes whose output feeds only a 0-gain node,
 * which causes `DynamicsCompressorNode.reduction` to read 0 even though
 * the user enabled the compressor. A floor of 0.0005 (~ -66 dBFS) is
 * inaudible but forces Chrome to keep pulling samples through the compressor,
 * so the Gain Reduction meter reflects reality at any mix setting.
 */
const WET_GAIN_FLOOR = 0.0005;

/** Pre-baked saturation curve for the bass enhancer. Soft-clip via tanh —
 *  preserves the fundamental and adds even/odd harmonics so small speakers
 *  *perceive* deeper bass without needing the actual low-frequency energy. */
const BASS_SATURATION_CURVE = (() => {
	const samples = 1024;
	const curve = new Float32Array(samples);
	const drive = 4;
	for (let i = 0; i < samples; i++) {
		const x = (i / (samples - 1)) * 2 - 1;
		curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
	}
	return curve;
})();

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private source: MediaElementAudioSourceNode | null = null;
	private boundElement: HTMLMediaElement | null = null;
	private pendingElement: HTMLMediaElement | null = null;
	private inputGainNode: GainNode | null = null;
	private filters: BiquadFilterNode[] = [];
	private compressor: DynamicsCompressorNode | null = null;
	private makeupGainNode: GainNode | null = null;
	private dryGainNode: GainNode | null = null;
	private wetGainNode: GainNode | null = null;
	private compMergeNode: GainNode | null = null;
	private analyser: AnalyserNode | null = null;
	private streamDest: MediaStreamAudioDestinationNode | null = null;
	/** Terminal node of the live chain (set each rebuild) — recording taps here. */
	private outputNode: AudioNode | null = null;
	/** Active recording tap; kept connected across chain rebuilds. */
	private recorderTap: MediaStreamAudioDestinationNode | null = null;
	private outputAudio: HTMLAudioElement | null = null;
	/**
	 * Master output gain — the user's volume/mute is applied HERE, not on the
	 * <video> element. Once an element is a MediaElementAudioSourceNode, its
	 * own `muted`/`volume` gate the signal *entering* the graph, so muting the
	 * element (which the player did for autoplay/preview/cleanup) feeds silence
	 * into the chain → EQ/Comp output goes dead. Keeping the element unmuted +
	 * full-volume and attenuating here is the only correct way to honour the
	 * volume slider while Web Audio owns output. */
	private masterGainNode: GainNode | null = null;
	private masterVolume = 1;
	private masterMuted = false;
	private eqEnabled = false;
	private compressorEnabled = false;
	private inputGainDb = 0;
	private currentBands: EqBand[] = [...DEFAULT_EQ_BANDS];
	private currentCompressor: CompressorSettings = { ...DEFAULT_COMPRESSOR };
	private attached = false;
	/** Pending post-effect silence probe (see scheduleSilenceProbe). */
	private silenceProbeTimer: ReturnType<typeof setTimeout> | null = null;
	/** One-shot guard so an auto-recovery reset can't loop. */
	private autoResetCount = 0;
	private static readonly MAX_AUTO_RESETS = 1;
	private deviceChangeListener: (() => void) | null = null;
	private interactionResumeListener: (() => void) | null = null;

	// ── Stereo widening (M/S processing) ──
	// width = 1 → no change. < 1 → narrower. > 1 → wider. 0 = mono.
	//
	// Implemented as a per-channel weighting matrix:
	//   L_out = ((1+w)/2) * L + ((1-w)/2) * R
	//   R_out = ((1-w)/2) * L + ((1+w)/2) * R
	// (algebraically equivalent to mid/side decode-scale-encode but avoids
	//  needing extra invert nodes for the right side.)
	private stereoWidthEnabled = false;
	private stereoWidthAmount = 1.5;
	private stereoSplitter: ChannelSplitterNode | null = null;
	private stereoSameL: GainNode | null = null; // L→L_out  (weight = (1+w)/2)
	private stereoSameR: GainNode | null = null; // R→R_out  (weight = (1+w)/2)
	private stereoOppL: GainNode | null = null; // R→L_out  (weight = (1-w)/2)
	private stereoOppR: GainNode | null = null; // L→R_out  (weight = (1-w)/2)
	private stereoMerger: ChannelMergerNode | null = null;

	// ── Bass enhancer ──
	// Splits low frequencies, runs them through soft-clip saturator to add
	// harmonics that the ear interprets as more bass, mixes back at amount level.
	private bassEnhanceEnabled = false;
	private bassEnhanceAmount = 0.4;
	private bassLowPass: BiquadFilterNode | null = null;
	private bassShaper: WaveShaperNode | null = null;
	private bassWetGain: GainNode | null = null;
	private bassDryPath: GainNode | null = null;
	private bassMerge: GainNode | null = null;

	// ── HRTF virtual surround (headphones) ──
	// Splits L/R, positions them as virtual speakers in 3D space using HRTF
	// panning to give a more spacious "out-of-the-head" impression.
	private hrtfEnabled = false;
	private hrtfAmount = 0.6;
	private hrtfSplitter: ChannelSplitterNode | null = null;
	private hrtfLeftPanner: PannerNode | null = null;
	private hrtfRightPanner: PannerNode | null = null;
	private hrtfDryGain: GainNode | null = null;
	private hrtfWetGain: GainNode | null = null;
	private hrtfMerge: GainNode | null = null;

	// ── Multi-band compressor ──
	// When enabled, replaces the single-compressor stage with a 3-band
	// split (low/mid/high) using crossover filters; each band has its own
	// DynamicsCompressorNode + makeup gain, and the three outputs sum back.
	private multiBandEnabled = false;
	private multiBandSettings: MultiBandCompressorSettings = {
		low: { ...DEFAULT_MULTIBAND.low },
		mid: { ...DEFAULT_MULTIBAND.mid },
		high: { ...DEFAULT_MULTIBAND.high },
		lowCrossover: DEFAULT_MULTIBAND.lowCrossover,
		highCrossover: DEFAULT_MULTIBAND.highCrossover,
	};
	private mbLowFilter: BiquadFilterNode | null = null;
	private mbMidLowFilter: BiquadFilterNode | null = null;
	private mbMidHighFilter: BiquadFilterNode | null = null;
	private mbHighFilter: BiquadFilterNode | null = null;
	private mbLowComp: DynamicsCompressorNode | null = null;
	private mbMidComp: DynamicsCompressorNode | null = null;
	private mbHighComp: DynamicsCompressorNode | null = null;
	private mbLowMakeup: GainNode | null = null;
	private mbMidMakeup: GainNode | null = null;
	private mbHighMakeup: GainNode | null = null;
	private mbMerge: GainNode | null = null;

	/**
	 * Register the media element for later lazy attachment. Does NOT create an
	 * AudioContext or `MediaElementSourceNode` — that only happens when the user
	 * actually enables EQ/compressor via {@link ensureAttached}. Until then the
	 * element plays through its native audio path, which follows the OS default
	 * output device (matches YouTube and any other `<video>` consumer).
	 */
	register(element: HTMLMediaElement): void {
		const info = {
			event: 'register',
			tag: element.tagName,
			crossOrigin: element.crossOrigin,
			src: element.src?.slice(0, 120),
			muted: element.muted,
			volume: element.volume,
			same: element === this.pendingElement ? 'same as before' : 'NEW element',
		};
		debug('audio:attach', info);
		dlog('[audioEngine] register()', info);
		this.pendingElement = element;
	}

	/**
	 * Attach to a video/audio element. Lazily called by {@link setEqEnabled} /
	 * {@link setCompressorEnabled} when first enabled. Direct callers can pass
	 * an explicit element; otherwise the previously {@link register}-ed
	 * element is used.
	 *
	 * Idempotent: calling with the same element is a no-op. Calling with a
	 * different element logs a warning and is refused — browsers permanently
	 * bind a `MediaElementSourceNode` to its element, so the only way to
	 * "re-attach" to a new element is to destroy() the engine first. The
	 * caller should ensure the video element is a singleton for the app
	 * lifetime.
	 */
	attach(element?: HTMLMediaElement): void {
		const target = element ?? this.pendingElement;
		const ctxInfo = {
			event: 'attach',
			haveTarget: !!target,
			alreadyAttached: this.attached,
			pendingElement: !!this.pendingElement,
		};
		debug('audio:attach', ctxInfo);
		dlog('[audioEngine] attach() called', ctxInfo);
		if (!target) {
			debug('audio:attach', { event: 'attach', result: 'bail-no-target' });
			dwarn('[audioEngine] attach() — no target element, bailing');
			return;
		}
		if (this.attached) {
			if (this.boundElement !== target) {
				debug('audio:attach', { event: 'attach', result: 'refused-different-element' });
				dwarn(
					'[audioEngine] attach() called with a different element than the one ' +
						'already bound. Ignoring — call destroy() first to re-bind.',
				);
			} else {
				debug('audio:attach', { event: 'attach', result: 'noop-same-element' });
				dlog('[audioEngine] attach() — already attached, no-op');
			}
			return;
		}

		// HARD GUARD: refuse to attach when the element is fed by an HLS
		// MediaSource (blob: URL). `createMediaElementSource` on such an
		// element produces SILENT output in Chrome (documented below) —
		// once bound, the element's audio is captured by a Web Audio graph
		// that emits nothing, and pausing/replaying makes the silence
		// obvious. Leaving the engine UNATTACHED keeps audio on the native
		// path, which works. The UI surfaces `audioEffectsHlsBlocked` so
		// the user learns EQ/Compressor only work on direct-play files.
		if (target.src?.startsWith('blob:')) {
			debug('audio:attach', { event: 'attach', result: 'refused-hls-mediasource' });
			dwarn(
				'[audioEngine] attach() refused — element is HLS MediaSource-backed ' +
					'(blob: src). createMediaElementSource would silence it in Chrome. ' +
					'Audio stays on the native path; EQ/Compressor unavailable for this stream.',
			);
			audioEffectsHlsBlocked.value = true;
			return;
		}
		audioEffectsHlsBlocked.value = false;

		try {
			// Construct with explicit sampleRate. Chrome's no-arg AudioContext
			// binds to the device's "preferred" rate at creation time, and
			// when the device binding is half-initialized (post storage-clear,
			// device hot-swap, focus-loss-during-sleep) it falls back to
			// 44100 against a sink that silently drops samples. Passing an
			// explicit rate routes through Chrome's internal resampler,
			// which decouples ctx from the device's native clock and
			// historically avoids that stuck-binding code path. 48000 is the
			// industry standard for video; cost vs no-arg is one resample
			// stage (~0.1% CPU).
			this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
			debug('audio:attach', {
				event: 'audio-context',
				state: this.ctx.state,
				sampleRate: this.ctx.sampleRate,
				outputLatency:
					(this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null,
				baseLatency:
					(this.ctx as AudioContext & { baseLatency?: number }).baseLatency ?? null,
			});
			// Heuristic stuck-sink detection. We can't directly observe
			// whether samples reach the speakers, but two signals correlate
			// strongly with the failure mode: outputLatency==0 (ctx never
			// bound to a real device) and sampleRate < 48000 (Chrome's safe
			// fallback when device negotiation didn't complete). Flag for
			// the UI; the user gets a "Reset Audio Output" affordance.
			const outputLatency =
				(this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null;
			if (outputLatency !== null && outputLatency <= 0) {
				markAudioSuspect(`outputLatency=${outputLatency}`);
			} else if (this.ctx.sampleRate < 48000) {
				markAudioSuspect(`sampleRate=${this.ctx.sampleRate} (fallback)`);
			} else {
				// Fresh attach with healthy-looking signals — clear any
				// stale suspect flag from a prior session.
				clearAudioSuspect();
			}
			dlog(
				`[audioEngine] new AudioContext → state=${this.ctx.state} sampleRate=${this.ctx.sampleRate}`,
			);

			// KNOWN CHROME LIMITATION:
			// createMediaElementSource on a <video> whose source is an
			// HLS MediaSource (blob: URL) produces silent output in
			// Chrome — even with crossOrigin='anonymous' and same-origin
			// content. MDN documents MediaSource as exempt from CORS
			// taint; Chrome's actual behavior contradicts that. Diagnostic
			// logging on prod confirmed: chain wires correctly to
			// ctx.destination, ctx.currentTime advances, yet speakers
			// stay silent.
			//
			// captureStream() + MediaStreamSource is also broken: the
			// MediaStreamTrack reports `live` with samples flowing per
			// the API surface, but no audio reaches the output.
			//
			// We use createMediaElementSource here for direct-play
			// content (where it works) and accept that EQ/compressor
			// silence the chain on HLS-backed streams. This is a Chrome
			// limitation we cannot work around from JS alone — would
			// require either server-side audio processing or switching
			// streams away from MediaSource (back to progressive
			// download).
			this.source = this.ctx.createMediaElementSource(target);
			this.boundElement = target;
			// CRITICAL: the element is now the graph's input. Its own
			// muted/volume gate what the source node receives, so a muted
			// element (set by the player for autoplay/preview/cleanup) would
			// feed silence into the EQ/Comp chain. Force it unmuted + full
			// volume; the user's volume/mute is honoured by masterGainNode
			// instead (see setMasterOutput / rebuildChain).
			target.muted = false;
			target.volume = 1;
			const boundInfo = {
				event: 'media-element-source-bound',
				tag: target.tagName,
				src: target.src?.slice(0, 120),
				crossOrigin: target.crossOrigin,
				muted: target.muted,
				volume: target.volume,
				readyState: target.readyState,
				usingMediaSource: !!target.src && target.src.startsWith('blob:'),
			};
			debug('audio:attach', boundInfo);
			dlog('[audioEngine] createMediaElementSource OK; element bound', boundInfo);
		} catch (err) {
			console.error('[audioEngine] Failed to create MediaElementSource:', err);
			this.ctx = null;
			this.source = null;
			this.boundElement = null;
			return;
		}

		dlog(
			`[audioEngine] attached. ctx.state=${this.ctx.state} sampleRate=${this.ctx.sampleRate} baseLatency=${(this.ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 'n/a'}`,
		);

		// Output routing.
		//
		// Default: route directly to `AudioContext.destination`. This is
		// the canonical Web Audio output path — zero extra latency, no
		// double-buffering, follows the OS default device via the
		// browser's normal audio sink resolution.
		//
		// Opt-in via `localStorage.mu_audio_use_mediastream = '1'`:
		// route through a `MediaStreamAudioDestinationNode` consumed by
		// a hidden `<audio>` element. This is the workaround for the
		// stale-sink bug we hit on Chrome/Windows once before — useful
		// fallback if `AudioContext.destination` ever stops producing
		// audio after an OS audio-device change. The cost when on is a
		// ~250–500ms HTMLMediaElement buffer that briefly overlaps with
		// the `<video>`'s native audio (until Chrome finishes muting
		// it), audible as a half-second echo that fades over the first
		// few seconds of playback.
		const useMediaStreamRouting =
			typeof localStorage !== 'undefined' &&
			localStorage.getItem('mu_audio_use_mediastream') === '1';

		if (useMediaStreamRouting) {
			this.streamDest = this.ctx.createMediaStreamDestination();
			this.outputAudio = document.createElement('audio');
			this.outputAudio.srcObject = this.streamDest.stream;
			this.outputAudio.autoplay = true;
			this.outputAudio.style.display = 'none';
			document.body.appendChild(this.outputAudio);
			// Force the output element onto the OS default device — Chrome
			// renders MediaStream-fed <audio> through the WebRTC audio
			// path, which has its own device routing separate from <video>.
			this.pinOutputAudioToDefault();
		}

		// Re-pin only if a non-default sink was previously set (rare —
		// only happens after the audio-device picker UI). Skips the
		// no-op call in the common already-default case because
		// setSinkId('') against an empty sinkId silences ctx.destination
		// in some Chrome builds. The real recovery for the stuck-sink
		// bug is requestAudioReset() (see audio-reset.state.ts), not
		// this method — see pinSinkToDefault() comment.
		this.pinSinkToDefault();

		// Force the context to running state. Chrome may start it suspended
		// even when attach() is reached from a click handler if signal/effect
		// indirection breaks the user-gesture chain. Without this, enabling
		// EQ/comp creates a silent context — and because
		// createMediaElementSource() permanently re-routes the element away
		// from its native audio path, that silence persists even after
		// disabling effects again. resume() is best-effort: if the browser
		// rejects (no user gesture credited yet) the global interaction
		// listener installed below picks it up on the next click/keypress.
		this.ctx
			.resume()
			.then(() => {
				dlog(`[audioEngine] resume() resolved. ctx.state=${this.ctx?.state}`);
				this.startOutputAudio();
			})
			.catch((err) => {
				// resume() rejection means the AudioContext is stuck
				// suspended. Gated on `mu_audio_debug` so it doesn't
				// noise the console on every page that mounts a
				// player — set `localStorage.mu_audio_debug = '1'`
				// to re-enable when diagnosing. The debug-panel sink
				// (debug('audio:attach', ...)) still captures the
				// outcome regardless.
				dwarn(
					'[audioEngine] AudioContext.resume() rejected — audio routed to a suspended graph until next user interaction. Cause:',
					err,
				);
				this.startOutputAudio();
			});
		this.installResumeOnInteraction();

		// Recover from OS audio device changes and context state transitions.
		this.installRecoveryHandlers();

		// Master output gain — carries the user's volume/mute (the <video>
		// element stays unmuted/full so the source node gets real signal).
		this.masterGainNode = this.ctx.createGain();
		this.masterGainNode.gain.value = this.masterMuted ? 0 : this.masterVolume;

		// Create input gain (Amp) node
		this.inputGainNode = this.ctx.createGain();
		this.inputGainNode.gain.value = this.dbToLinear(this.inputGainDb);

		// Create EQ filter chain
		this.filters = this.currentBands.map((band) => {
			const filter = this.ctx!.createBiquadFilter();
			filter.type = band.type;
			filter.frequency.value = band.frequency;
			filter.gain.value = band.gain;
			filter.Q.value = band.q;
			return filter;
		});

		// Create compressor
		this.compressor = this.ctx.createDynamicsCompressor();
		this.applyCompressorSettings(this.currentCompressor);

		// Makeup gain after compressor
		this.makeupGainNode = this.ctx.createGain();
		this.makeupGainNode.gain.value = this.dbToLinear(this.currentCompressor.makeupGain);

		// Dry/wet mix nodes for parallel compression
		this.dryGainNode = this.ctx.createGain();
		this.wetGainNode = this.ctx.createGain();
		this.compMergeNode = this.ctx.createGain();
		this.applyMix(this.currentCompressor.mix);

		// Spectrum analyser — tapped post-EQ in rebuildChain() so the
		// frequency-domain visualization reflects the EQ-applied signal.
		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 8192;
		this.analyser.smoothingTimeConstant = 0.7;

		// ── Stereo widening (per-channel weighting matrix) ──
		this.stereoSplitter = this.ctx.createChannelSplitter(2);
		this.stereoSameL = this.ctx.createGain();
		this.stereoSameR = this.ctx.createGain();
		this.stereoOppL = this.ctx.createGain();
		this.stereoOppR = this.ctx.createGain();
		this.stereoMerger = this.ctx.createChannelMerger(2);
		this.applyStereoWidth(this.stereoWidthAmount);

		// ── Bass enhancer ──
		this.bassLowPass = this.ctx.createBiquadFilter();
		this.bassLowPass.type = 'lowpass';
		this.bassLowPass.frequency.value = 150;
		this.bassLowPass.Q.value = 0.7;
		this.bassShaper = this.ctx.createWaveShaper();
		this.bassShaper.curve = BASS_SATURATION_CURVE;
		this.bassShaper.oversample = '2x';
		this.bassWetGain = this.ctx.createGain();
		this.bassDryPath = this.ctx.createGain();
		this.bassDryPath.gain.value = 1;
		this.bassMerge = this.ctx.createGain();
		this.applyBassEnhanceAmount(this.bassEnhanceAmount);

		// ── HRTF virtual surround (headphones only) ──
		// Position L and R as virtual front-left / front-right speakers
		// at ~30° spread, ~1m forward — gives a small "out-of-the-head"
		// effect with HRTF panning. Higher amount = wider virtual stage.
		this.hrtfSplitter = this.ctx.createChannelSplitter(2);
		this.hrtfLeftPanner = this.ctx.createPanner();
		this.hrtfRightPanner = this.ctx.createPanner();
		for (const p of [this.hrtfLeftPanner, this.hrtfRightPanner]) {
			p.panningModel = 'HRTF';
			p.distanceModel = 'inverse';
			p.refDistance = 1;
			p.maxDistance = 10000;
			p.rolloffFactor = 0;
		}
		this.hrtfDryGain = this.ctx.createGain();
		this.hrtfWetGain = this.ctx.createGain();
		this.hrtfMerge = this.ctx.createGain();
		this.applyHrtfAmount(this.hrtfAmount);

		// ── Multi-band compressor ──
		// Crossover filters: low band uses lowpass at `lowCrossover`,
		// high band uses highpass at `highCrossover`, mid uses
		// highpass→lowpass between the two crossovers. Q=0.7 gives a
		// gentle (Butterworth-ish) slope that sums close to flat.
		this.mbLowFilter = this.ctx.createBiquadFilter();
		this.mbLowFilter.type = 'lowpass';
		this.mbLowFilter.Q.value = 0.7;
		this.mbMidLowFilter = this.ctx.createBiquadFilter();
		this.mbMidLowFilter.type = 'highpass';
		this.mbMidLowFilter.Q.value = 0.7;
		this.mbMidHighFilter = this.ctx.createBiquadFilter();
		this.mbMidHighFilter.type = 'lowpass';
		this.mbMidHighFilter.Q.value = 0.7;
		this.mbHighFilter = this.ctx.createBiquadFilter();
		this.mbHighFilter.type = 'highpass';
		this.mbHighFilter.Q.value = 0.7;
		this.applyCrossovers(
			this.multiBandSettings.lowCrossover,
			this.multiBandSettings.highCrossover,
		);
		this.mbLowComp = this.ctx.createDynamicsCompressor();
		this.mbMidComp = this.ctx.createDynamicsCompressor();
		this.mbHighComp = this.ctx.createDynamicsCompressor();
		this.mbLowMakeup = this.ctx.createGain();
		this.mbMidMakeup = this.ctx.createGain();
		this.mbHighMakeup = this.ctx.createGain();
		this.applyBandSettings('low', this.multiBandSettings.low);
		this.applyBandSettings('mid', this.multiBandSettings.mid);
		this.applyBandSettings('high', this.multiBandSettings.high);
		this.mbMerge = this.ctx.createGain();

		this.attached = true;
		this.rebuildChain();
	}

	isAttached(): boolean {
		return this.attached;
	}

	/**
	 * Apply the player's volume slider + mute state to the graph's master
	 * gain. Called by the video engine in place of touching the <video>
	 * element's own volume/muted while Web Audio owns output (muting the
	 * element would silence the source node feeding the effect chain).
	 */
	setMasterOutput(volume: number, muted: boolean): void {
		this.masterVolume = Math.max(0, Math.min(1, volume));
		this.masterMuted = muted;
		// Keep the bound element out of the gain path — it must stay unmuted
		// + full so the MediaElementSource receives signal.
		if (this.boundElement) {
			this.boundElement.muted = false;
			this.boundElement.volume = 1;
		}
		if (this.masterGainNode) {
			this.masterGainNode.gain.value = this.masterMuted ? 0 : this.masterVolume;
		}
	}

	/**
	 * Tap the (effects-processed) audio for recording. Returns an audio
	 * MediaStreamTrack carrying the live graph output, or null when no Web
	 * Audio graph is active (e.g. HLS/blob: playback) — callers then fall back
	 * to the <video> element's own captureStream audio.
	 */
	createRecordingAudioTrack(): MediaStreamTrack | null {
		if (!this.attached || !this.ctx || !this.outputNode) return null;
		try {
			this.recorderTap?.disconnect();
			this.recorderTap = this.ctx.createMediaStreamDestination();
			this.outputNode.connect(this.recorderTap);
			return this.recorderTap.stream.getAudioTracks()[0] ?? null;
		} catch {
			return null;
		}
	}

	/** Tear down the recording tap. */
	stopRecordingTap(): void {
		try {
			this.recorderTap?.disconnect();
		} catch {
			/* ignore */
		}
		this.recorderTap = null;
	}

	/**
	 * Full diagnostic snapshot of the engine + bound element. Logged
	 * around every toggle and chain rebuild so we can see exactly
	 * what state the graph is in when audio dies. Unconditional —
	 * not gated on a debug flag — because the previous version
	 * surfaced nothing when audio silently failed and we lost a day
	 * of debugging.
	 */
	dumpState(label: string): void {
		const v = this.boundElement as HTMLMediaElement | null;
		const snapshot: Record<string, unknown> = {
			label,
			attached: this.attached,
			ctx: this.ctx
				? {
						state: this.ctx.state,
						sampleRate: this.ctx.sampleRate,
						baseLatency: (this.ctx as AudioContext & { baseLatency?: number })
							.baseLatency,
						currentTime: this.ctx.currentTime,
					}
				: null,
			source: this.source ? 'MediaElementSourceNode' : null,
			boundElement: v
				? {
						tag: v.tagName,
						src: v.src?.slice(0, 120),
						crossOrigin: v.crossOrigin,
						muted: v.muted,
						volume: v.volume,
						paused: v.paused,
						readyState: v.readyState,
						networkState: v.networkState,
					}
				: null,
			enables: {
				eq: this.eqEnabled,
				compressor: this.compressorEnabled,
				stereoWidth: this.stereoWidthEnabled,
				bassEnhance: this.bassEnhanceEnabled,
				hrtf: this.hrtfEnabled,
				multiBand: this.multiBandEnabled,
			},
			eqFilters: this.filters.map((f) => ({
				type: f.type,
				freq: f.frequency.value,
				gain: f.gain.value,
				q: f.Q.value,
			})),
			compressorSettings: this.compressor
				? {
						threshold: this.compressor.threshold.value,
						knee: this.compressor.knee.value,
						ratio: this.compressor.ratio.value,
						attack: this.compressor.attack.value,
						release: this.compressor.release.value,
						reduction: this.compressor.reduction,
					}
				: null,
			gains: {
				inputGain: this.inputGainNode?.gain.value,
				makeupGain: this.makeupGainNode?.gain.value,
				dryGain: this.dryGainNode?.gain.value,
				wetGain: this.wetGainNode?.gain.value,
			},
			routing: {
				useStreamDest: !!this.streamDest,
				outputAudioExists: !!this.outputAudio,
				outputAudioPaused: this.outputAudio?.paused,
				outputAudioVolume: this.outputAudio?.volume,
				outputAudioMuted: this.outputAudio?.muted,
			},
		};
		debug('audio:state', snapshot);
		dlog('[audioEngine STATE]', snapshot);
	}

	setEqEnabled(enabled: boolean): void {
		debug('audio:toggle', { event: 'setEqEnabled', enabled });
		dlog(`[audioEngine] setEqEnabled(${enabled}) — entering`);
		this.dumpState(`setEqEnabled(${enabled}) BEFORE`);
		this.eqEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx
				?.resume()
				.then(() => dlog('[audioEngine] resume after setEqEnabled → ok'))
				.catch((err) => dwarn('[audioEngine] resume after setEqEnabled REJECTED:', err));
		}
		this.rebuildChain();
		this.dumpState(`setEqEnabled(${enabled}) AFTER`);
	}

	setCompressorEnabled(enabled: boolean): void {
		debug('audio:toggle', { event: 'setCompressorEnabled', enabled });
		dlog(`[audioEngine] setCompressorEnabled(${enabled}) — entering`);
		this.dumpState(`setCompressorEnabled(${enabled}) BEFORE`);
		this.compressorEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx
				?.resume()
				.then(() => dlog('[audioEngine] resume after setCompressorEnabled → ok'))
				.catch((err) =>
					dwarn('[audioEngine] resume after setCompressorEnabled REJECTED:', err),
				);
		}
		if (!enabled) {
			// When disabling, reset dry/wet gains to safe values
			if (this.dryGainNode) this.dryGainNode.gain.value = 1;
			if (this.wetGainNode) this.wetGainNode.gain.value = 0;
		}
		this.rebuildChain();
		if (enabled) {
			// Re-apply current mix and compressor settings after chain rebuild
			this.applyMix(this.currentCompressor.mix);
			this.applyCompressorSettings(this.currentCompressor);
		}
		this.dumpState(`setCompressorEnabled(${enabled}) AFTER`);
	}

	getEqEnabled(): boolean {
		return this.eqEnabled;
	}

	getCompressorEnabled(): boolean {
		return this.compressorEnabled;
	}

	// ── Multi-band compressor ──
	setMultiBandEnabled(enabled: boolean): void {
		this.multiBandEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx?.resume().catch(() => {});
		}
		this.rebuildChain();
	}
	getMultiBandEnabled(): boolean {
		return this.multiBandEnabled;
	}
	setBandCompressorSettings(band: CompressorBand, s: CompressorSettings): void {
		this.multiBandSettings[band] = { ...s };
		this.applyBandSettings(band, s);
	}
	getBandCompressorSettings(band: CompressorBand): CompressorSettings {
		return { ...this.multiBandSettings[band] };
	}
	setBandCrossovers(low: number, high: number): void {
		const lo = Math.max(40, Math.min(2000, low));
		const hi = Math.max(lo + 100, Math.min(16000, high));
		this.multiBandSettings.lowCrossover = lo;
		this.multiBandSettings.highCrossover = hi;
		this.applyCrossovers(lo, hi);
	}
	getBandCrossovers(): { low: number; high: number } {
		return {
			low: this.multiBandSettings.lowCrossover,
			high: this.multiBandSettings.highCrossover,
		};
	}
	getBandReduction(band: CompressorBand): number {
		const comp =
			band === 'low' ? this.mbLowComp : band === 'mid' ? this.mbMidComp : this.mbHighComp;
		return comp?.reduction ?? 0;
	}

	// ── Stereo width ──
	setStereoWidthEnabled(enabled: boolean): void {
		this.stereoWidthEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx?.resume().catch(() => {});
		}
		this.rebuildChain();
	}
	setStereoWidthAmount(amount: number): void {
		this.stereoWidthAmount = Math.max(0, Math.min(2, amount));
		this.applyStereoWidth(this.stereoWidthAmount);
	}
	getStereoWidthEnabled(): boolean {
		return this.stereoWidthEnabled;
	}
	getStereoWidthAmount(): number {
		return this.stereoWidthAmount;
	}

	// ── Bass enhancer ──
	setBassEnhanceEnabled(enabled: boolean): void {
		this.bassEnhanceEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx?.resume().catch(() => {});
		}
		this.rebuildChain();
	}
	setBassEnhanceAmount(amount: number): void {
		this.bassEnhanceAmount = Math.max(0, Math.min(1, amount));
		this.applyBassEnhanceAmount(this.bassEnhanceAmount);
	}
	getBassEnhanceEnabled(): boolean {
		return this.bassEnhanceEnabled;
	}
	getBassEnhanceAmount(): number {
		return this.bassEnhanceAmount;
	}

	// ── HRTF virtual surround ──
	setHrtfEnabled(enabled: boolean): void {
		this.hrtfEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx?.resume().catch(() => {});
		}
		this.rebuildChain();
	}
	setHrtfAmount(amount: number): void {
		this.hrtfAmount = Math.max(0, Math.min(1, amount));
		this.applyHrtfAmount(this.hrtfAmount);
	}
	getHrtfEnabled(): boolean {
		return this.hrtfEnabled;
	}
	getHrtfAmount(): number {
		return this.hrtfAmount;
	}

	setInputGain(db: number): void {
		this.inputGainDb = db;
		if (this.inputGainNode) {
			this.inputGainNode.gain.value = this.dbToLinear(db);
		}
	}

	getInputGain(): number {
		return this.inputGainDb;
	}

	updateBand(index: number, gain: number): void {
		if (index < 0 || index >= this.currentBands.length) return;
		this.currentBands[index]!.gain = gain;
		if (this.filters[index]) {
			this.filters[index]!.gain.value = gain;
		}
	}

	updateBandQ(index: number, q: number): void {
		if (index < 0 || index >= this.currentBands.length) return;
		this.currentBands[index]!.q = q;
		if (this.filters[index]) {
			this.filters[index]!.Q.value = q;
		}
	}

	setBands(bands: EqBand[]): void {
		this.currentBands = bands.map((b) => ({ ...b }));
		this.filters.forEach((filter, i) => {
			const band = bands[i];
			if (band) {
				filter.type = band.type;
				filter.frequency.value = band.frequency;
				filter.gain.value = band.gain;
				filter.Q.value = band.q;
			}
		});
	}

	getBands(): EqBand[] {
		return this.currentBands.map((b) => ({ ...b }));
	}

	setCompressorSettings(settings: CompressorSettings): void {
		this.currentCompressor = { ...settings };
		this.applyCompressorSettings(settings);
		if (this.makeupGainNode) {
			this.makeupGainNode.gain.value = this.dbToLinear(settings.makeupGain);
		}
		this.applyMix(settings.mix);
	}

	getCompressorSettings(): CompressorSettings {
		return { ...this.currentCompressor };
	}

	resetEq(): void {
		this.setBands(DEFAULT_EQ_BANDS.map((b) => ({ ...b })));
	}

	resetCompressor(): void {
		this.setCompressorSettings({ ...DEFAULT_COMPRESSOR });
	}

	getCompressorReduction(): number {
		if (!this.compressor) return 0;
		return this.compressor.reduction;
	}

	/** FFT size of the spectrum analyser (0 if not attached). */
	getFftSize(): number {
		return this.analyser?.fftSize ?? 0;
	}

	/** Sample rate of the AudioContext (or 44100 fallback). */
	getSampleRate(): number {
		return this.ctx?.sampleRate ?? 44100;
	}

	/**
	 * Fill `buffer` with the current frequency magnitudes (0..255). Buffer
	 * length should be `getFftSize() / 2`. Returns false if no analyser
	 * exists yet (engine not attached).
	 */
	getFrequencyData(buffer: Uint8Array): boolean {
		if (!this.analyser) return false;
		this.analyser.getByteFrequencyData(buffer);
		return true;
	}

	/**
	 * Fill `buffer` with raw PCM samples (0..255 around 128 for silence).
	 * Buffer length should be `getFftSize()`. Returns false if no
	 * analyser exists yet. Use this to compute peak / RMS levels for
	 * meters and live signal indicators.
	 */
	getTimeDomainData(buffer: Uint8Array): boolean {
		if (!this.analyser) return false;
		this.analyser.getByteTimeDomainData(buffer);
		return true;
	}

	/**
	 * List available audio output devices. Labels are empty until the user
	 * has granted microphone permission to this origin (Chrome quirk).
	 */
	async listOutputDevices(): Promise<{ deviceId: string; label: string }[]> {
		if (!navigator.mediaDevices?.enumerateDevices) return [];
		const all = await navigator.mediaDevices.enumerateDevices();
		return all
			.filter((d) => d.kind === 'audiooutput')
			.map((d) => ({ deviceId: d.deviceId, label: d.label || '(no label)' }));
	}

	/**
	 * Force the audio output onto a specific device id. Pass '' (empty
	 * string) for the OS default. In direct routing mode (default) the
	 * sink id is set on the AudioContext; in MediaStream-routing mode
	 * it's set on the hidden output <audio> element.
	 */
	async setOutputDevice(deviceId: string): Promise<void> {
		if (!this.ctx) {
			throw new Error('Audio engine not attached. Enable EQ or compressor first.');
		}
		const target = (this.outputAudio ?? this.ctx) as {
			setSinkId?: (id: string) => Promise<void>;
		};
		if (typeof target.setSinkId !== 'function') {
			throw new Error('setSinkId not supported in this browser');
		}
		await target.setSinkId(deviceId);
		dlog(`[audioEngine] output device set to ${deviceId || '(default)'}`);
	}

	/**
	 * Play a 1-second 440Hz tone through whichever output path is
	 * active (AudioContext.destination by default, or the hidden
	 * <audio> element when MediaStream routing is enabled). Lets you
	 * verify the output path independently of the video source.
	 */
	async playTestTone(): Promise<void> {
		this.attach();
		if (!this.ctx) {
			throw new Error('Audio engine not attached');
		}
		await this.ctx.resume().catch(() => {});
		const osc = this.ctx.createOscillator();
		const gain = this.ctx.createGain();
		osc.frequency.value = 440;
		gain.gain.value = 0.15;
		osc.connect(gain);
		gain.connect(this.streamDest ?? this.ctx.destination);
		osc.start();
		dlog('[audioEngine] test tone (440Hz) for 1s');
		setTimeout(() => {
			osc.stop();
			osc.disconnect();
			gain.disconnect();
		}, 1000);
	}

	/** Create/resume AudioContext. Call from user gesture (click). */
	ensureContext(): void {
		if (this.ctx && this.ctx.state === 'suspended') {
			this.ctx.resume().catch(() => {});
		}
	}

	/** Resume AudioContext if suspended (browser autoplay policy). */
	async resume(): Promise<void> {
		if (this.ctx?.state === 'suspended') {
			try {
				await this.ctx.resume();
			} catch {
				// Browser blocked resume (no user gesture yet) — will retry on next play event
			}
		}
	}

	destroy(): void {
		if (this.silenceProbeTimer) {
			clearTimeout(this.silenceProbeTimer);
			this.silenceProbeTimer = null;
		}
		this.removeInteractionResumeListener();
		if (this.deviceChangeListener && navigator.mediaDevices) {
			navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeListener);
			this.deviceChangeListener = null;
		}
		if (this.source) {
			this.source.disconnect();
			this.source = null;
		}
		if (this.ctx) {
			this.ctx.close().catch(() => {});
			this.ctx = null;
		}
		if (this.outputAudio) {
			this.outputAudio.srcObject = null;
			this.outputAudio.remove();
			this.outputAudio = null;
		}
		this.streamDest = null;
		this.analyser = null;
		this.masterGainNode = null;
		this.inputGainNode = null;
		this.filters = [];
		this.compressor = null;
		this.makeupGainNode = null;
		this.dryGainNode = null;
		this.wetGainNode = null;
		this.compMergeNode = null;
		this.stereoSplitter = null;
		this.stereoSameL = null;
		this.stereoSameR = null;
		this.stereoOppL = null;
		this.stereoOppR = null;
		this.stereoMerger = null;
		this.bassLowPass = null;
		this.bassShaper = null;
		this.bassWetGain = null;
		this.bassDryPath = null;
		this.bassMerge = null;
		this.hrtfSplitter = null;
		this.hrtfLeftPanner = null;
		this.hrtfRightPanner = null;
		this.hrtfDryGain = null;
		this.hrtfWetGain = null;
		this.hrtfMerge = null;
		this.mbLowFilter = null;
		this.mbMidLowFilter = null;
		this.mbMidHighFilter = null;
		this.mbHighFilter = null;
		this.mbLowComp = null;
		this.mbMidComp = null;
		this.mbHighComp = null;
		this.mbLowMakeup = null;
		this.mbMidMakeup = null;
		this.mbHighMakeup = null;
		this.mbMerge = null;
		this.boundElement = null;
		this.attached = false;
	}

	// ── Private ──

	/**
	 * Re-pin the AudioContext output to the system default sink — for
	 * the rare case where something else (e.g. an explicit
	 * `setOutputDevice(deviceId)` from the UI's audio-device picker)
	 * set a non-default sink earlier. Skipped when the sink is already
	 * empty/default: calling `setSinkId('')` against an already-empty
	 * `sinkId` silences `ctx.destination` in affected Chrome builds.
	 *
	 * Note: this does NOT recover from the stuck-sink bug — once a
	 * ctx is bound to a half-initialized device, `setSinkId` against
	 * the same ctx can't fix it. The recovery path is `requestAudioReset()`
	 * in audio-reset.state.ts, which tears down the ctx + swaps the
	 * `<video>` element.
	 */
	private pinSinkToDefault(): void {
		if (!this.ctx) {
			debug('audio:sink', { event: 'pin-no-ctx' });
			return;
		}
		const ctxWithSink = this.ctx as AudioContext & {
			setSinkId?: (id: string) => Promise<void>;
			sinkId?: string;
		};
		const setSinkIdAvailable = typeof ctxWithSink.setSinkId === 'function';
		const currentSinkId = ctxWithSink.sinkId ?? '';
		debug('audio:sink', {
			event: 'pin-attempt',
			setSinkIdAvailable,
			currentSinkId: currentSinkId || '(unset)',
		});
		if (!setSinkIdAvailable) {
			debug('audio:sink', { event: 'pin-not-supported' });
			return;
		}
		// Already-default → skip. Calling setSinkId('') against an
		// already-default sink can silence ctx.destination in some
		// Chrome versions. The default device is what we want anyway,
		// so the call is a no-op semantically and a footgun in practice.
		if (currentSinkId === '') {
			debug('audio:sink', { event: 'pin-skipped-already-default' });
			return;
		}
		ctxWithSink.setSinkId
			.call(this.ctx, '')
			.then(() => {
				debug('audio:sink', {
					event: 'pin-success',
					newSinkId: ctxWithSink.sinkId ?? '(unset)',
				});
			})
			.catch((err: unknown) => {
				const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
				debug('audio:sink', { event: 'pin-failed', error: msg });
				dwarn('[audioEngine] AudioContext.setSinkId(default) failed:', err);
			});
	}

	private pinOutputAudioToDefault(): void {
		if (!this.outputAudio) return;
		const el = this.outputAudio as HTMLAudioElement & {
			setSinkId?: (id: string) => Promise<void>;
		};
		if (typeof el.setSinkId !== 'function') {
			dwarn('[audioEngine] <audio>.setSinkId not supported in this browser');
			return;
		}
		el.setSinkId('')
			.then(() => {
				dlog('[audioEngine] <audio>.setSinkId(default) ok');
			})
			.catch((err: unknown) => {
				dwarn('[audioEngine] <audio>.setSinkId(default) failed:', err);
			});
	}

	private installResumeOnInteraction(): void {
		if (this.interactionResumeListener || typeof document === 'undefined') return;
		const handler = () => {
			if (!this.ctx) return;
			if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
				this.ctx.resume().catch(() => {});
			}
		};
		this.interactionResumeListener = handler;
		document.addEventListener('pointerdown', handler, { capture: true });
		document.addEventListener('keydown', handler, { capture: true });
	}

	private removeInteractionResumeListener(): void {
		if (!this.interactionResumeListener || typeof document === 'undefined') return;
		document.removeEventListener('pointerdown', this.interactionResumeListener, {
			capture: true,
		});
		document.removeEventListener('keydown', this.interactionResumeListener, {
			capture: true,
		});
		this.interactionResumeListener = null;
	}

	private startOutputAudio(): void {
		if (!this.outputAudio) return;
		const tracks = this.streamDest?.stream.getAudioTracks() ?? [];
		dlog(
			`[audioEngine] starting output <audio>. tracks=${tracks.length} ctx.state=${this.ctx?.state}`,
		);
		this.outputAudio
			.play()
			.then(() => {
				dlog('[audioEngine] output <audio> playing.');
			})
			.catch((err) => {
				dwarn('[audioEngine] output <audio> play() rejected:', err);
			});
	}

	private installRecoveryHandlers(): void {
		if (!this.ctx) return;
		this.ctx.addEventListener('statechange', () => {
			const state = this.ctx?.state;
			dlog(`[audioEngine] ctx statechange → ${state}`);
			if (state === 'suspended' || state === 'interrupted') {
				this.ctx?.resume().catch(() => {});
			} else if (state === 'running') {
				this.startOutputAudio();
			}
		});
		if (navigator.mediaDevices && !this.deviceChangeListener) {
			this.deviceChangeListener = () => {
				if (!this.ctx) return;
				// Device change while a MediaElementSource is bound is the
				// canonical trigger for the stuck-sink bug — the ctx is
				// still pointed at the now-stale device. Flag it so the
				// next EQ/Comp toggle prompts the user to reset.
				markAudioSuspect('audio device changed mid-session');
				if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
					this.ctx.resume().catch(() => {});
				}
				this.pinSinkToDefault();
				this.pinOutputAudioToDefault();
			};
			navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeListener);
		}
	}

	private rebuildChain(): void {
		if (!this.ctx || !this.source) {
			debug('audio:chain', { event: 'rebuild', result: 'bail-no-ctx-or-source' });
			dlog('[audioEngine] rebuildChain() — no ctx/source, bailing');
			return;
		}
		const trace: string[] = [];
		const traceConnect = (from: string, to: string) => trace.push(`${from} → ${to}`);

		// Disconnect everything
		this.source.disconnect();
		this.masterGainNode?.disconnect();
		this.inputGainNode?.disconnect();
		for (const f of this.filters) f.disconnect();
		this.compressor?.disconnect();
		this.makeupGainNode?.disconnect();
		this.dryGainNode?.disconnect();
		this.wetGainNode?.disconnect();
		this.compMergeNode?.disconnect();
		this.stereoSplitter?.disconnect();
		this.stereoSameL?.disconnect();
		this.stereoSameR?.disconnect();
		this.stereoOppL?.disconnect();
		this.stereoOppR?.disconnect();
		this.stereoMerger?.disconnect();
		this.bassLowPass?.disconnect();
		this.bassShaper?.disconnect();
		this.bassWetGain?.disconnect();
		this.bassDryPath?.disconnect();
		this.bassMerge?.disconnect();
		this.hrtfSplitter?.disconnect();
		this.hrtfLeftPanner?.disconnect();
		this.hrtfRightPanner?.disconnect();
		this.hrtfDryGain?.disconnect();
		this.hrtfWetGain?.disconnect();
		this.hrtfMerge?.disconnect();
		this.mbLowFilter?.disconnect();
		this.mbMidLowFilter?.disconnect();
		this.mbMidHighFilter?.disconnect();
		this.mbHighFilter?.disconnect();
		this.mbLowComp?.disconnect();
		this.mbMidComp?.disconnect();
		this.mbHighComp?.disconnect();
		this.mbLowMakeup?.disconnect();
		this.mbMidMakeup?.disconnect();
		this.mbHighMakeup?.disconnect();
		this.mbMerge?.disconnect();

		// Build chain: source → [Amp] → [EQ] → [Compressor] → [Stereo Width] → [Bass] → [HRTF] → destination
		let current: AudioNode = this.source;
		traceConnect('source', '(start)');

		const anyEffectOn =
			this.eqEnabled ||
			this.compressorEnabled ||
			this.stereoWidthEnabled ||
			this.bassEnhanceEnabled ||
			this.hrtfEnabled;

		// Amp / input-gain: apply whenever ANY effect is active, so the Amp
		// slider works independently of which effects are on.
		if (anyEffectOn && this.inputGainNode) {
			current.connect(this.inputGainNode);
			traceConnect('source', `inputGain (val=${this.inputGainNode.gain.value})`);
			current = this.inputGainNode;
		}

		if (this.eqEnabled && this.filters.length > 0) {
			for (const filter of this.filters) {
				current.connect(filter);
				current = filter;
			}
			traceConnect('inputGain', `${this.filters.length} EQ filters`);
		}

		// Tap the analyser AFTER the EQ stage (or at source if no EQ) so
		// the spectrum reflects the EQ-applied signal. Analyser is a
		// side-tap — connecting to it does not affect the main routing.
		if (this.analyser) current.connect(this.analyser);

		if (this.compressorEnabled) {
			if (
				this.multiBandEnabled &&
				this.mbLowFilter &&
				this.mbMidLowFilter &&
				this.mbMidHighFilter &&
				this.mbHighFilter &&
				this.mbLowComp &&
				this.mbMidComp &&
				this.mbHighComp &&
				this.mbLowMakeup &&
				this.mbMidMakeup &&
				this.mbHighMakeup &&
				this.mbMerge &&
				this.dryGainNode &&
				this.wetGainNode &&
				this.compMergeNode
			) {
				// Multi-band: split into low/mid/high, compress each band
				// independently, sum back to mbMerge. The whole multi-band
				// stage then participates in the dry/wet mix exactly like
				// the single compressor would, so the user's mix slider
				// keeps working.
				current.connect(this.dryGainNode);
				this.dryGainNode.connect(this.compMergeNode);
				// Low band: lowpass → comp → makeup → merge
				current.connect(this.mbLowFilter);
				this.mbLowFilter.connect(this.mbLowComp);
				this.mbLowComp.connect(this.mbLowMakeup);
				this.mbLowMakeup.connect(this.mbMerge);
				// Mid band: highpass(low) → lowpass(high) → comp → makeup → merge
				current.connect(this.mbMidLowFilter);
				this.mbMidLowFilter.connect(this.mbMidHighFilter);
				this.mbMidHighFilter.connect(this.mbMidComp);
				this.mbMidComp.connect(this.mbMidMakeup);
				this.mbMidMakeup.connect(this.mbMerge);
				// High band: highpass → comp → makeup → merge
				current.connect(this.mbHighFilter);
				this.mbHighFilter.connect(this.mbHighComp);
				this.mbHighComp.connect(this.mbHighMakeup);
				this.mbHighMakeup.connect(this.mbMerge);
				// Multi-band output through the wet path (so the existing
				// mix slider still controls dry/wet on the whole thing)
				this.mbMerge.connect(this.wetGainNode);
				this.wetGainNode.connect(this.compMergeNode);
				current = this.compMergeNode;
			} else if (
				this.compressor &&
				this.makeupGainNode &&
				this.dryGainNode &&
				this.wetGainNode &&
				this.compMergeNode
			) {
				// Single-band parallel compression (unchanged).
				current.connect(this.dryGainNode);
				this.dryGainNode.connect(this.compMergeNode);
				current.connect(this.compressor);
				this.compressor.connect(this.makeupGainNode);
				this.makeupGainNode.connect(this.wetGainNode);
				this.wetGainNode.connect(this.compMergeNode);
				current = this.compMergeNode;
			}
		}

		// Stereo widening via per-channel weighting (see member comment).
		if (
			this.stereoWidthEnabled &&
			this.stereoSplitter &&
			this.stereoMerger &&
			this.stereoSameL &&
			this.stereoSameR &&
			this.stereoOppL &&
			this.stereoOppR
		) {
			current.connect(this.stereoSplitter);
			this.stereoSplitter.connect(this.stereoSameL, 0);
			this.stereoSplitter.connect(this.stereoOppR, 0);
			this.stereoSplitter.connect(this.stereoOppL, 1);
			this.stereoSplitter.connect(this.stereoSameR, 1);
			this.stereoSameL.connect(this.stereoMerger, 0, 0);
			this.stereoOppL.connect(this.stereoMerger, 0, 0);
			this.stereoOppR.connect(this.stereoMerger, 0, 1);
			this.stereoSameR.connect(this.stereoMerger, 0, 1);
			current = this.stereoMerger;
		}

		// Bass enhancer — parallel: dry passes through, low-pass + saturator
		// adds harmonics, scaled wet portion sums back in.
		if (
			this.bassEnhanceEnabled &&
			this.bassLowPass &&
			this.bassShaper &&
			this.bassWetGain &&
			this.bassDryPath &&
			this.bassMerge
		) {
			current.connect(this.bassDryPath);
			this.bassDryPath.connect(this.bassMerge);
			current.connect(this.bassLowPass);
			this.bassLowPass.connect(this.bassShaper);
			this.bassShaper.connect(this.bassWetGain);
			this.bassWetGain.connect(this.bassMerge);
			current = this.bassMerge;
		}

		// HRTF virtual surround — parallel: dry stereo + virtually-positioned
		// L and R routed through HRTF panners.
		if (
			this.hrtfEnabled &&
			this.hrtfSplitter &&
			this.hrtfLeftPanner &&
			this.hrtfRightPanner &&
			this.hrtfDryGain &&
			this.hrtfWetGain &&
			this.hrtfMerge
		) {
			// Dry path
			current.connect(this.hrtfDryGain);
			this.hrtfDryGain.connect(this.hrtfMerge);
			// Wet path — split, pan each channel separately
			current.connect(this.hrtfSplitter);
			this.hrtfSplitter.connect(this.hrtfLeftPanner, 0);
			this.hrtfSplitter.connect(this.hrtfRightPanner, 1);
			this.hrtfLeftPanner.connect(this.hrtfWetGain);
			this.hrtfRightPanner.connect(this.hrtfWetGain);
			this.hrtfWetGain.connect(this.hrtfMerge);
			current = this.hrtfMerge;
		}

		// Defensive: the element must never be muted while it's the source —
		// the player mutes it for autoplay/preview/cleanup, and a stale mute
		// would silence the whole chain. Volume/mute lives on masterGainNode.
		if (this.boundElement) {
			this.boundElement.muted = false;
			this.boundElement.volume = 1;
		}

		// Master output gain (user volume/mute) sits last, just before the
		// destination, so it attenuates the final mix regardless of which
		// effects are active.
		if (this.masterGainNode) {
			current.connect(this.masterGainNode);
			traceConnect('lastStage', `masterGain (val=${this.masterGainNode.gain.value})`);
			current = this.masterGainNode;
		}

		// Route to streamDest (consumed by hidden <audio> element) when
		// available; fall back to AudioContext.destination if creation
		// failed for any reason.
		const finalDest = this.streamDest ?? this.ctx.destination;
		current.connect(finalDest);
		// Remember the terminal node and re-attach an active recording tap so a
		// chain rebuild (toggling EQ mid-recording) doesn't drop the captured audio.
		this.outputNode = current;
		if (this.recorderTap) current.connect(this.recorderTap);
		traceConnect('masterGain', this.streamDest ? 'streamDest' : 'ctx.destination');
		const chainInfo = {
			event: 'rebuild-done',
			anyEffectOn,
			ctxState: this.ctx.state,
			finalDest: this.streamDest ? 'streamDest (MediaStream)' : 'ctx.destination',
			trace,
		};
		debug('audio:chain', chainInfo);
		dlog('[audioEngine] rebuildChain done', chainInfo);

		// When effects are active, verify (shortly after) that audio actually
		// flows THROUGH the chain. Chrome's MediaElementSource can land in a
		// state where the graph is wired + ctx is running yet the source emits
		// silence — the symptom users hit as "no audio with EQ/Comp on".
		if (anyEffectOn) this.scheduleSilenceProbe();
	}

	/**
	 * Schedule a one-shot check of the analyser ~600ms after a chain rebuild:
	 * if the element is playing unmuted but the post-effect signal is flatline
	 * silence, the MediaElementSource/ctx is in the flaky silent state. We flag
	 * it and auto-trigger a single audio reset (ctx + element swap) to recover,
	 * so the user doesn't have to do it by hand.
	 */
	private scheduleSilenceProbe(): void {
		if (typeof window === 'undefined' || !this.analyser) return;
		if (this.silenceProbeTimer) clearTimeout(this.silenceProbeTimer);
		this.silenceProbeTimer = setTimeout(() => {
			this.silenceProbeTimer = null;
			this.probeEffectSilence();
		}, 600);
	}

	private probeEffectSilence(): void {
		if (!this.attached || !this.ctx || !this.analyser) return;
		const el = this.boundElement;
		// Only meaningful when the element should be producing audible signal.
		if (!el || el.paused || el.muted || el.volume === 0 || this.masterMuted) return;
		if (this.ctx.state !== 'running') return;
		const anyEffectOn =
			this.eqEnabled ||
			this.compressorEnabled ||
			this.stereoWidthEnabled ||
			this.bassEnhanceEnabled ||
			this.hrtfEnabled;
		if (!anyEffectOn) return;

		const buf = new Uint8Array(this.analyser.fftSize);
		this.analyser.getByteTimeDomainData(buf);
		let peak = 0;
		for (let i = 0; i < buf.length; i++) {
			const d = Math.abs((buf[i] ?? 128) - 128);
			if (d > peak) peak = d;
		}
		const outputLatency =
			(this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null;
		const info = {
			event: 'effect-silence-probe',
			peak,
			outputLatency,
			usingStreamDest: !!this.streamDest,
			ctxCurrentTime: this.ctx.currentTime,
			elementTime: el.currentTime,
			autoResetCount: this.autoResetCount,
		};
		debug('audio:silence', info);
		dlog('[audioEngine] silence probe', info);

		// peak ≈ 0 → no signal reaches the analyser (post-EQ) even though the
		// element is playing. The MediaElementSource latched to silence — only
		// a ctx+element swap recovers it. (A real audio frame deviates from
		// the 128 silence midpoint; ≤1 is numerically silent.)
		if (peak <= 1) {
			dwarn('[audioEngine] effect chain output is silent (peak≈0)', info);
			markAudioSuspect('effects output silent');
			if (this.autoResetCount < AudioEngine.MAX_AUTO_RESETS) {
				this.autoResetCount++;
				dwarn('[audioEngine] auto-recovering via one audio reset.');
				requestAudioReset();
			}
			return;
		}

		// peak > 1 → signal IS flowing through the graph, so the chain is
		// fine. If we're still routing to AudioContext.destination and the
		// sink looks dead (outputLatency 0), the destination is stuck: the
		// graph renders but nothing reaches the speakers, and a fresh ctx
		// reproduces the same dead sink. Escalate to MediaStream routing
		// (hidden <audio> via MediaStreamAudioDestinationNode), which plays
		// through Chrome's separate WebRTC output path and sidesteps it.
		if (
			!this.streamDest &&
			outputLatency !== null &&
			outputLatency <= 0 &&
			this.autoResetCount < AudioEngine.MAX_AUTO_RESETS
		) {
			this.autoResetCount++;
			dwarn(
				'[audioEngine] signal present but ctx.destination sink looks dead — ' +
					'switching to MediaStream output routing.',
				info,
			);
			markAudioSuspect('output sink stuck — using alternate routing');
			this.switchToMediaStreamOutput();
		}
	}

	/**
	 * Move the graph's output off the (apparently dead) AudioContext.destination
	 * onto a MediaStreamAudioDestinationNode consumed by a hidden <audio>
	 * element. Chrome routes MediaStream-fed <audio> through a separate output
	 * path, which recovers audio when ctx.destination is in the stuck-sink
	 * state. Idempotent — no-op once streamDest exists.
	 */
	private switchToMediaStreamOutput(): void {
		if (!this.ctx || this.streamDest || typeof document === 'undefined') return;
		try {
			this.streamDest = this.ctx.createMediaStreamDestination();
			this.outputAudio = document.createElement('audio');
			this.outputAudio.srcObject = this.streamDest.stream;
			this.outputAudio.autoplay = true;
			this.outputAudio.style.display = 'none';
			document.body.appendChild(this.outputAudio);
			this.pinOutputAudioToDefault();
			// Rebuild so the chain terminates at streamDest, then start the
			// hidden element playing.
			this.rebuildChain();
			this.startOutputAudio();
			dwarn('[audioEngine] switched to MediaStream output routing.');
		} catch (err) {
			dwarn('[audioEngine] switchToMediaStreamOutput failed:', err);
			this.streamDest = null;
		}
	}

	private applyCompressorSettings(s: CompressorSettings): void {
		if (!this.compressor) return;
		this.compressor.threshold.value = s.threshold;
		this.compressor.knee.value = s.knee;
		this.compressor.ratio.value = s.ratio;
		this.compressor.attack.value = s.attack;
		this.compressor.release.value = s.release;
	}

	private applyBandSettings(band: CompressorBand, s: CompressorSettings): void {
		const comp =
			band === 'low' ? this.mbLowComp : band === 'mid' ? this.mbMidComp : this.mbHighComp;
		const makeup =
			band === 'low'
				? this.mbLowMakeup
				: band === 'mid'
					? this.mbMidMakeup
					: this.mbHighMakeup;
		if (comp) {
			comp.threshold.value = s.threshold;
			comp.knee.value = s.knee;
			comp.ratio.value = s.ratio;
			comp.attack.value = s.attack;
			comp.release.value = s.release;
		}
		if (makeup) {
			makeup.gain.value = this.dbToLinear(s.makeupGain);
		}
	}

	private applyCrossovers(low: number, high: number): void {
		if (this.mbLowFilter) this.mbLowFilter.frequency.value = low;
		if (this.mbMidLowFilter) this.mbMidLowFilter.frequency.value = low;
		if (this.mbMidHighFilter) this.mbMidHighFilter.frequency.value = high;
		if (this.mbHighFilter) this.mbHighFilter.frequency.value = high;
	}

	private applyStereoWidth(width: number): void {
		const same = (1 + width) / 2;
		const opp = (1 - width) / 2;
		if (this.stereoSameL) this.stereoSameL.gain.value = same;
		if (this.stereoSameR) this.stereoSameR.gain.value = same;
		if (this.stereoOppL) this.stereoOppL.gain.value = opp;
		if (this.stereoOppR) this.stereoOppR.gain.value = opp;
	}

	private applyBassEnhanceAmount(amount: number): void {
		// amount in 0..1 — wet gain controls how much of the saturated
		// low-band gets summed back. Dry passes through unchanged.
		if (this.bassWetGain) this.bassWetGain.gain.value = amount;
	}

	private applyHrtfAmount(amount: number): void {
		// amount in 0..1 — controls dry/wet between the original stereo
		// signal and the virtually-positioned HRTF version.
		if (this.hrtfDryGain) this.hrtfDryGain.gain.value = 1 - amount;
		if (this.hrtfWetGain) this.hrtfWetGain.gain.value = amount;
		// Spread the virtual speakers wider as amount increases.
		const spread = 0.3 + amount * 0.7; // 0.3 → 1.0
		if (this.hrtfLeftPanner) {
			this.hrtfLeftPanner.positionX.value = -spread;
			this.hrtfLeftPanner.positionY.value = 0;
			this.hrtfLeftPanner.positionZ.value = -1;
		}
		if (this.hrtfRightPanner) {
			this.hrtfRightPanner.positionX.value = spread;
			this.hrtfRightPanner.positionY.value = 0;
			this.hrtfRightPanner.positionZ.value = -1;
		}
	}

	private applyMix(mix: number): void {
		const wet = Math.max(0, Math.min(1, mix ?? 1));
		const dry = 1 - wet;
		if (this.dryGainNode) this.dryGainNode.gain.value = dry;
		// Floor wet gain to a tiny non-zero value when the compressor is
		// enabled, so Chrome keeps pulling samples through the compressor and
		// the Gain Reduction meter stays live. The floor is inaudible.
		if (this.wetGainNode) {
			this.wetGainNode.gain.value = this.compressorEnabled
				? Math.max(wet, WET_GAIN_FLOOR)
				: wet;
		}
	}

	private dbToLinear(db: number): number {
		return 10 ** (db / 20);
	}
}

/** Diagnostic logger gated by `localStorage.mu_audio_debug = '1'`.
 * Mirrors the HLS debug-flag convention used in the player engine.
 * Errors are not gated — they always surface. */
function dlog(...args: unknown[]): void {
	if (typeof localStorage === 'undefined') return;
	if (localStorage.getItem('mu_audio_debug') === '1') console.log(...args);
}
function dwarn(...args: unknown[]): void {
	if (typeof localStorage === 'undefined') return;
	if (localStorage.getItem('mu_audio_debug') === '1') console.warn(...args);
}

/** Singleton audio engine instance shared across the app. */
export const audioEngine = new AudioEngine();

if (typeof window !== 'undefined') {
	(window as Window & { __audioEngine?: AudioEngine }).__audioEngine = audioEngine;
}

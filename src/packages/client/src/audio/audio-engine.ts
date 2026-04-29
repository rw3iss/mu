/**
 * Audio processing engine using Web Audio API.
 *
 * Chain: MediaElementSource → EQ Filters → Compressor → Gain → Destination
 *
 * When both EQ and compressor are disabled, the source connects directly
 * to the destination (zero-overhead pass-through).
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

/**
 * Minimum wet-gain when the compressor is enabled. Web Audio (Chrome) will
 * cull processing of upstream nodes whose output feeds only a 0-gain node,
 * which causes `DynamicsCompressorNode.reduction` to read 0 even though
 * the user enabled the compressor. A floor of 0.0005 (~ -66 dBFS) is
 * inaudible but forces Chrome to keep pulling samples through the compressor,
 * so the Gain Reduction meter reflects reality at any mix setting.
 */
const WET_GAIN_FLOOR = 0.0005;

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
	private outputAudio: HTMLAudioElement | null = null;
	private eqEnabled = false;
	private compressorEnabled = false;
	private inputGainDb = 0;
	private currentBands: EqBand[] = [...DEFAULT_EQ_BANDS];
	private currentCompressor: CompressorSettings = { ...DEFAULT_COMPRESSOR };
	private attached = false;
	private deviceChangeListener: (() => void) | null = null;
	private interactionResumeListener: (() => void) | null = null;

	/**
	 * Register the media element for later lazy attachment. Does NOT create an
	 * AudioContext or `MediaElementSourceNode` — that only happens when the user
	 * actually enables EQ/compressor via {@link ensureAttached}. Until then the
	 * element plays through its native audio path, which follows the OS default
	 * output device (matches YouTube and any other `<video>` consumer).
	 */
	register(element: HTMLMediaElement): void {
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
		if (!target) return;
		if (this.attached) {
			if (this.boundElement !== target) {
				console.warn(
					'[audioEngine] attach() called with a different element than the one ' +
						'already bound. Ignoring — call destroy() first to re-bind. This ' +
						'indicates the video element is being recreated across component ' +
						'remounts; the new element will bypass EQ/compressor processing.',
				);
			}
			return;
		}

		try {
			this.ctx = new AudioContext({ latencyHint: 'playback' });
			this.source = this.ctx.createMediaElementSource(target);
			this.boundElement = target;
		} catch (err) {
			console.error('[audioEngine] Failed to create MediaElementSource:', err);
			this.ctx = null;
			this.source = null;
			this.boundElement = null;
			return;
		}

		console.log(
			`[audioEngine] attached. ctx.state=${this.ctx.state} sampleRate=${this.ctx.sampleRate} baseLatency=${(this.ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 'n/a'}`,
		);

		// Route audio output through a MediaStream consumed by a hidden
		// <audio> element instead of `AudioContext.destination`. On
		// Chrome/Windows, AudioContext.destination can pin to a stale audio
		// sink after OS audio changes (and `setSinkId('')` does not always
		// recover it). HTMLMediaElement uses the native audio path that
		// always follows the OS default device — same path <video> and
		// YouTube use. The hidden <audio> element pulls from the Web Audio
		// graph via MediaStream, so EQ/compressor still apply.
		this.streamDest = this.ctx.createMediaStreamDestination();
		this.outputAudio = document.createElement('audio');
		this.outputAudio.srcObject = this.streamDest.stream;
		this.outputAudio.autoplay = true;
		this.outputAudio.style.display = 'none';
		document.body.appendChild(this.outputAudio);

		// Force the output element onto the OS default audio device. Chrome
		// renders MediaStream-fed <audio> elements through the WebRTC audio
		// path, which has its own device routing separate from regular
		// <video> playback — so even if <video> is fine, this element can
		// be pinned to a stale sink. setSinkId('') resolves to the current
		// default device. Re-applied on devicechange via pinSinkToDefault().
		this.pinOutputAudioToDefault();

		// Belt-and-suspenders: also try to pin AudioContext.destination to
		// the OS default device. Even though we route through streamDest,
		// some Chrome builds gate stream production on destination state.
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
				console.log(`[audioEngine] resume() resolved. ctx.state=${this.ctx?.state}`);
				this.startOutputAudio();
			})
			.catch((err) => {
				console.warn('[audioEngine] resume() rejected:', err);
				this.startOutputAudio();
			});
		this.installResumeOnInteraction();

		// Recover from OS audio device changes and context state transitions.
		this.installRecoveryHandlers();

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

		this.attached = true;
		this.rebuildChain();
	}

	isAttached(): boolean {
		return this.attached;
	}

	setEqEnabled(enabled: boolean): void {
		this.eqEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx?.resume().catch(() => {});
		}
		this.rebuildChain();
	}

	setCompressorEnabled(enabled: boolean): void {
		this.compressorEnabled = enabled;
		if (enabled) {
			this.attach();
			this.ctx?.resume().catch(() => {});
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
	}

	getEqEnabled(): boolean {
		return this.eqEnabled;
	}

	getCompressorEnabled(): boolean {
		return this.compressorEnabled;
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
	 * Force the hidden output <audio> element onto a specific device id.
	 * Pass '' (empty string) to use the OS default. Use this when the
	 * default sink is broken on the current Chrome process.
	 */
	async setOutputDevice(deviceId: string): Promise<void> {
		if (!this.outputAudio) {
			throw new Error('Audio engine not attached. Enable EQ or compressor first.');
		}
		const el = this.outputAudio as HTMLAudioElement & {
			setSinkId?: (id: string) => Promise<void>;
		};
		if (typeof el.setSinkId !== 'function') {
			throw new Error('HTMLMediaElement.setSinkId not supported in this browser');
		}
		await el.setSinkId(deviceId);
		console.log(`[audioEngine] output device set to ${deviceId || '(default)'}`);
	}

	/**
	 * Play a 1-second 440Hz tone through the same hidden output element
	 * the chain feeds into. Lets you verify the output path independently
	 * of the video source. If you can't hear this tone, the output sink
	 * itself is broken and no setSinkId() can fix it from JS — restart
	 * Chrome or pick a different device via setOutputDevice().
	 */
	async playTestTone(): Promise<void> {
		this.attach();
		if (!this.ctx || !this.streamDest) {
			throw new Error('Audio engine not attached');
		}
		await this.ctx.resume().catch(() => {});
		const osc = this.ctx.createOscillator();
		const gain = this.ctx.createGain();
		osc.frequency.value = 440;
		gain.gain.value = 0.15;
		osc.connect(gain);
		gain.connect(this.streamDest);
		osc.start();
		console.log('[audioEngine] test tone (440Hz) → streamDest for 1s');
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
		this.inputGainNode = null;
		this.filters = [];
		this.compressor = null;
		this.makeupGainNode = null;
		this.dryGainNode = null;
		this.wetGainNode = null;
		this.compMergeNode = null;
		this.boundElement = null;
		this.attached = false;
	}

	// ── Private ──

	private pinSinkToDefault(): void {
		if (!this.ctx) return;
		const setSinkId = (this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> })
			.setSinkId;
		if (typeof setSinkId !== 'function') return;
		setSinkId.call(this.ctx, '').catch((err: unknown) => {
			console.warn('[audioEngine] AudioContext.setSinkId(default) failed:', err);
		});
	}

	private pinOutputAudioToDefault(): void {
		if (!this.outputAudio) return;
		const el = this.outputAudio as HTMLAudioElement & {
			setSinkId?: (id: string) => Promise<void>;
		};
		if (typeof el.setSinkId !== 'function') {
			console.warn('[audioEngine] <audio>.setSinkId not supported in this browser');
			return;
		}
		el.setSinkId('')
			.then(() => {
				console.log('[audioEngine] <audio>.setSinkId(default) ok');
			})
			.catch((err: unknown) => {
				console.warn('[audioEngine] <audio>.setSinkId(default) failed:', err);
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
		console.log(
			`[audioEngine] starting output <audio>. tracks=${tracks.length} ctx.state=${this.ctx?.state}`,
		);
		this.outputAudio
			.play()
			.then(() => {
				console.log('[audioEngine] output <audio> playing.');
			})
			.catch((err) => {
				console.warn('[audioEngine] output <audio> play() rejected:', err);
			});
	}

	private installRecoveryHandlers(): void {
		if (!this.ctx) return;
		this.ctx.addEventListener('statechange', () => {
			const state = this.ctx?.state;
			console.log(`[audioEngine] ctx statechange → ${state}`);
			if (state === 'suspended' || state === 'interrupted') {
				this.ctx?.resume().catch(() => {});
			} else if (state === 'running') {
				this.startOutputAudio();
			}
		});
		if (navigator.mediaDevices && !this.deviceChangeListener) {
			this.deviceChangeListener = () => {
				if (!this.ctx) return;
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
		if (!this.ctx || !this.source) return;

		// Disconnect everything
		this.source.disconnect();
		this.inputGainNode?.disconnect();
		for (const f of this.filters) f.disconnect();
		this.compressor?.disconnect();
		this.makeupGainNode?.disconnect();
		this.dryGainNode?.disconnect();
		this.wetGainNode?.disconnect();
		this.compMergeNode?.disconnect();

		// Build chain: source → [Amp/inputGain] → [EQ] → [Compressor w/ dry/wet mix] → destination
		let current: AudioNode = this.source;

		// Amp / input-gain: apply whenever EITHER effect is active, so the Amp
		// slider works independently of the EQ bands.
		if ((this.eqEnabled || this.compressorEnabled) && this.inputGainNode) {
			current.connect(this.inputGainNode);
			current = this.inputGainNode;
		}

		if (this.eqEnabled && this.filters.length > 0) {
			for (const filter of this.filters) {
				current.connect(filter);
				current = filter;
			}
		}

		// Tap the analyser AFTER the EQ stage (or at source if no EQ) so
		// the spectrum reflects the EQ-applied signal. Analyser is a
		// side-tap — connecting to it does not affect the main routing.
		if (this.analyser) current.connect(this.analyser);

		if (
			this.compressorEnabled &&
			this.compressor &&
			this.makeupGainNode &&
			this.dryGainNode &&
			this.wetGainNode &&
			this.compMergeNode
		) {
			// Parallel compression: split into dry + wet, merge at compMergeNode
			// Dry path: current → dryGain → merge
			current.connect(this.dryGainNode);
			this.dryGainNode.connect(this.compMergeNode);
			// Wet path: current → compressor → makeupGain → wetGain → merge
			current.connect(this.compressor);
			this.compressor.connect(this.makeupGainNode);
			this.makeupGainNode.connect(this.wetGainNode);
			this.wetGainNode.connect(this.compMergeNode);

			current = this.compMergeNode;
		}

		// Route to streamDest (consumed by hidden <audio> element) when
		// available; fall back to AudioContext.destination if creation
		// failed for any reason.
		current.connect(this.streamDest ?? this.ctx.destination);
	}

	private applyCompressorSettings(s: CompressorSettings): void {
		if (!this.compressor) return;
		this.compressor.threshold.value = s.threshold;
		this.compressor.knee.value = s.knee;
		this.compressor.ratio.value = s.ratio;
		this.compressor.attack.value = s.attack;
		this.compressor.release.value = s.release;
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

/** Singleton audio engine instance shared across the app. */
export const audioEngine = new AudioEngine();

if (typeof window !== 'undefined') {
	(window as Window & { __audioEngine?: AudioEngine }).__audioEngine = audioEngine;
}

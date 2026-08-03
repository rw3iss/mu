import {
	audioEngine,
	type CompressorSettings,
	DEFAULT_COMPRESSOR,
	DEFAULT_EQ_BANDS,
	type EqBand,
} from './audio-engine';

/**
 * Microphone processing engine for the Shared Sessions voice pipeline.
 *
 * This is an ADDITIVE sibling of {@link AudioEngine}: it reuses the same DSP
 * concepts (10-band EQ biquads + a parallel dry/wet DynamicsCompressor + an
 * analyser tap) but is source/sink-agnostic. The playback `audioEngine`
 * singleton is left completely untouched — its `<video>`-specific guards,
 * keep-alive, silence-probe and stuck-sink recovery all stay on the playback
 * instance only.
 *
 * Signal flow when active:
 *   getUserMedia(mic) → MediaStreamSource
 *     → InputGain
 *     → EQ filters (10-band, bypassable)
 *     → analyser tap (post-EQ)
 *     → Compressor (parallel dry/wet, bypassable)
 *     → MediaStreamDestination
 *   → dest.stream.getAudioTracks()[0]  ← handed to each RTCPeerConnection
 *
 * The processed track's `enabled` flag is the mute switch (mesh/UI drive it).
 *
 * It exposes the SAME setBands / setCompressorSettings / getFrequencyData /
 * getTimeDomainData / getCompressorReduction surface the EQ / Compressor tabs
 * already use against the playback engine, so the voice panel can reuse those
 * visualiser/meter components against a MicAudioEngine instance.
 */

/** Constraints passed to getUserMedia (voice-optimised defaults). */
export interface MicConstraints {
	echoCancellation: boolean;
	noiseSuppression: boolean;
	autoGainControl: boolean;
	deviceId?: string;
}

export const DEFAULT_MIC_CONSTRAINTS: MicConstraints = {
	echoCancellation: true,
	noiseSuppression: true,
	autoGainControl: true,
};

export class MicAudioEngine {
	private ctx: AudioContext | null = null;
	/** True when `ctx` is borrowed from the playback engine (do NOT close it). */
	private ctxBorrowed = false;
	private stream: MediaStream | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private dest: MediaStreamAudioDestinationNode | null = null;

	private inputGainNode: GainNode | null = null;
	private filters: BiquadFilterNode[] = [];
	private analyser: AnalyserNode | null = null;
	private compressor: DynamicsCompressorNode | null = null;
	private makeupGainNode: GainNode | null = null;
	private dryGainNode: GainNode | null = null;
	private wetGainNode: GainNode | null = null;
	private compMergeNode: GainNode | null = null;

	private eqEnabled = false;
	private compressorEnabled = false;
	private inputGainDb = 0;
	private currentBands: EqBand[] = DEFAULT_EQ_BANDS.map((b) => ({ ...b }));
	private currentCompressor: CompressorSettings = { ...DEFAULT_COMPRESSOR };
	private constraints: MicConstraints = { ...DEFAULT_MIC_CONSTRAINTS };
	private started = false;

	/**
	 * Acquire the microphone and build the processing graph. Prompts the browser
	 * mic-permission dialog on first use. Idempotent — a second call is a no-op
	 * (use {@link setInputDevice} / {@link setConstraints} to change capture).
	 *
	 * Honours the `mu_voice_shared_ctx` feature flag: when set (and the playback
	 * engine already has a context) it reuses that AudioContext so mic + movie
	 * share one context/device; default is a fully isolated context.
	 */
	async start(constraints?: Partial<MicConstraints>): Promise<void> {
		if (this.started) return;
		if (constraints) this.constraints = { ...this.constraints, ...constraints };

		if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			throw new Error('Microphone capture is not supported in this browser.');
		}

		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: this.buildAudioConstraints(),
		});

		const shared =
			typeof localStorage !== 'undefined' &&
			localStorage.getItem('mu_voice_shared_ctx') === '1';
		const borrowed = shared ? audioEngine.getContext() : null;
		if (borrowed) {
			this.ctx = borrowed;
			this.ctxBorrowed = true;
		} else {
			this.ctx = new AudioContext({ latencyHint: 'interactive' });
			this.ctxBorrowed = false;
		}
		await this.ctx.resume().catch(() => {});

		this.buildNodes();
		this.source = this.ctx.createMediaStreamSource(this.stream);
		this.dest = this.ctx.createMediaStreamDestination();
		this.started = true;
		this.rebuildChain();
	}

	isStarted(): boolean {
		return this.started;
	}

	/**
	 * The processed microphone track fed to every peer connection, or null when
	 * the engine hasn't started. Its `enabled` flag doubles as the mute switch.
	 */
	getProcessedTrack(): MediaStreamTrack | null {
		return this.dest?.stream.getAudioTracks()[0] ?? null;
	}

	/** Mute/unmute the outgoing mic by toggling the processed track. */
	setTrackEnabled(enabled: boolean): void {
		const track = this.getProcessedTrack();
		if (track) track.enabled = enabled;
	}

	/** Swap the capture device, keeping the graph + processed track identity. */
	async setInputDevice(deviceId: string): Promise<void> {
		this.constraints = { ...this.constraints, deviceId: deviceId || undefined };
		await this.reacquire();
	}

	/** Re-apply getUserMedia constraints (echo/noise/AGC toggles). */
	async setConstraints(constraints: Partial<MicConstraints>): Promise<void> {
		this.constraints = { ...this.constraints, ...constraints };
		await this.reacquire();
	}

	getConstraints(): MicConstraints {
		return { ...this.constraints };
	}

	/** List available audio-input devices (labels require mic permission). */
	async listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
		if (!navigator.mediaDevices?.enumerateDevices) return [];
		const all = await navigator.mediaDevices.enumerateDevices();
		return all
			.filter((d) => d.kind === 'audioinput')
			.map((d) => ({ deviceId: d.deviceId, label: d.label || '(no label)' }));
	}

	// ── EQ / Compressor API (mirrors AudioEngine) ──

	setEqEnabled(enabled: boolean): void {
		this.eqEnabled = enabled;
		this.rebuildChain();
	}
	getEqEnabled(): boolean {
		return this.eqEnabled;
	}

	setCompressorEnabled(enabled: boolean): void {
		this.compressorEnabled = enabled;
		if (!enabled) {
			if (this.dryGainNode) this.dryGainNode.gain.value = 1;
			if (this.wetGainNode) this.wetGainNode.gain.value = 0;
		}
		this.rebuildChain();
		if (enabled) this.applyCompressorSettings(this.currentCompressor);
	}
	getCompressorEnabled(): boolean {
		return this.compressorEnabled;
	}

	setInputGain(db: number): void {
		this.inputGainDb = db;
		if (this.inputGainNode) this.inputGainNode.gain.value = this.dbToLinear(db);
	}
	getInputGain(): number {
		return this.inputGainDb;
	}

	updateBand(index: number, gain: number): void {
		const band = this.currentBands[index];
		if (!band) return;
		band.gain = gain;
		const f = this.filters[index];
		if (f) f.gain.value = gain;
	}

	updateBandQ(index: number, q: number): void {
		const band = this.currentBands[index];
		if (!band) return;
		band.q = q;
		const f = this.filters[index];
		if (f) f.Q.value = q;
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
	}
	getCompressorSettings(): CompressorSettings {
		return { ...this.currentCompressor };
	}

	getCompressorReduction(): number {
		return this.compressor?.reduction ?? 0;
	}

	getFftSize(): number {
		return this.analyser?.fftSize ?? 0;
	}
	getSampleRate(): number {
		return this.ctx?.sampleRate ?? 48000;
	}
	getFrequencyData(buffer: Uint8Array): boolean {
		if (!this.analyser) return false;
		this.analyser.getByteFrequencyData(buffer);
		return true;
	}
	getTimeDomainData(buffer: Uint8Array): boolean {
		if (!this.analyser) return false;
		this.analyser.getByteTimeDomainData(buffer);
		return true;
	}

	/** Release the mic + tear down the graph. */
	destroy(): void {
		try {
			this.source?.disconnect();
		} catch {
			/* ignore */
		}
		for (const t of this.stream?.getTracks() ?? []) {
			try {
				t.stop();
			} catch {
				/* ignore */
			}
		}
		if (this.ctx && !this.ctxBorrowed) {
			this.ctx.close().catch(() => {});
		}
		this.ctx = null;
		this.ctxBorrowed = false;
		this.stream = null;
		this.source = null;
		this.dest = null;
		this.inputGainNode = null;
		this.filters = [];
		this.analyser = null;
		this.compressor = null;
		this.makeupGainNode = null;
		this.dryGainNode = null;
		this.wetGainNode = null;
		this.compMergeNode = null;
		this.started = false;
	}

	// ── Private ──

	private buildAudioConstraints(): MediaTrackConstraints {
		const c: MediaTrackConstraints = {
			echoCancellation: this.constraints.echoCancellation,
			noiseSuppression: this.constraints.noiseSuppression,
			autoGainControl: this.constraints.autoGainControl,
			channelCount: 1,
		};
		if (this.constraints.deviceId) c.deviceId = { exact: this.constraints.deviceId };
		return c;
	}

	private async reacquire(): Promise<void> {
		if (!this.started || !this.ctx) {
			// Not running yet — the next start() will pick up the new constraints.
			return;
		}
		const next = await navigator.mediaDevices.getUserMedia({
			audio: this.buildAudioConstraints(),
		});
		// Preserve the current mute state on the outgoing track.
		const wasEnabled = this.getProcessedTrack()?.enabled ?? true;
		try {
			this.source?.disconnect();
		} catch {
			/* ignore */
		}
		for (const t of this.stream?.getTracks() ?? []) {
			try {
				t.stop();
			} catch {
				/* ignore */
			}
		}
		this.stream = next;
		this.source = this.ctx.createMediaStreamSource(next);
		this.rebuildChain();
		this.setTrackEnabled(wasEnabled);
	}

	private buildNodes(): void {
		if (!this.ctx) return;
		this.inputGainNode = this.ctx.createGain();
		this.inputGainNode.gain.value = this.dbToLinear(this.inputGainDb);

		this.filters = this.currentBands.map((band) => {
			const filter = this.ctx!.createBiquadFilter();
			filter.type = band.type;
			filter.frequency.value = band.frequency;
			filter.gain.value = band.gain;
			filter.Q.value = band.q;
			return filter;
		});

		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 8192;
		this.analyser.smoothingTimeConstant = 0.7;

		this.compressor = this.ctx.createDynamicsCompressor();
		this.applyCompressorSettings(this.currentCompressor);
		this.makeupGainNode = this.ctx.createGain();
		this.makeupGainNode.gain.value = this.dbToLinear(this.currentCompressor.makeupGain);
		this.dryGainNode = this.ctx.createGain();
		this.wetGainNode = this.ctx.createGain();
		this.compMergeNode = this.ctx.createGain();
	}

	private rebuildChain(): void {
		if (!this.ctx || !this.source || !this.dest) return;

		this.source.disconnect();
		this.inputGainNode?.disconnect();
		for (const f of this.filters) f.disconnect();
		this.compressor?.disconnect();
		this.makeupGainNode?.disconnect();
		this.dryGainNode?.disconnect();
		this.wetGainNode?.disconnect();
		this.compMergeNode?.disconnect();

		let current: AudioNode = this.source;

		if (this.inputGainNode) {
			current.connect(this.inputGainNode);
			current = this.inputGainNode;
		}

		if (this.eqEnabled && this.filters.length > 0) {
			for (const filter of this.filters) {
				current.connect(filter);
				current = filter;
			}
		}

		// Analyser is a side-tap post-EQ (mirrors AudioEngine) — doesn't affect routing.
		if (this.analyser) current.connect(this.analyser);

		if (
			this.compressorEnabled &&
			this.compressor &&
			this.makeupGainNode &&
			this.dryGainNode &&
			this.wetGainNode &&
			this.compMergeNode
		) {
			current.connect(this.dryGainNode);
			this.dryGainNode.connect(this.compMergeNode);
			current.connect(this.compressor);
			this.compressor.connect(this.makeupGainNode);
			this.makeupGainNode.connect(this.wetGainNode);
			this.wetGainNode.connect(this.compMergeNode);
			current = this.compMergeNode;
			this.applyMix(this.currentCompressor.mix);
		}

		current.connect(this.dest);
	}

	private applyCompressorSettings(s: CompressorSettings): void {
		if (this.compressor) {
			this.compressor.threshold.value = s.threshold;
			this.compressor.knee.value = s.knee;
			this.compressor.ratio.value = s.ratio;
			this.compressor.attack.value = s.attack;
			this.compressor.release.value = s.release;
		}
		if (this.makeupGainNode) {
			this.makeupGainNode.gain.value = this.dbToLinear(s.makeupGain);
		}
		this.applyMix(s.mix);
	}

	private applyMix(mix: number): void {
		const wet = Math.max(0, Math.min(1, mix ?? 1));
		if (this.dryGainNode) this.dryGainNode.gain.value = 1 - wet;
		if (this.wetGainNode) this.wetGainNode.gain.value = wet;
	}

	private dbToLinear(db: number): number {
		return 10 ** (db / 20);
	}
}

/** Singleton mic engine for the app's shared-session voice panel. */
export const micAudioEngine = new MicAudioEngine();

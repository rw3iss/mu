// ============================================
// Web Audio API Engine
// ============================================

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
	{ frequency: 60, gain: 0, q: 1, type: 'lowshelf' },
	{ frequency: 230, gain: 0, q: 1, type: 'peaking' },
	{ frequency: 910, gain: 0, q: 1, type: 'peaking' },
	{ frequency: 3600, gain: 0, q: 1, type: 'peaking' },
	{ frequency: 14000, gain: 0, q: 1, type: 'highshelf' },
];

export const DEFAULT_COMPRESSOR: CompressorSettings = {
	threshold: -24,
	knee: 30,
	ratio: 4,
	attack: 0.003,
	release: 0.25,
	makeupGain: 0,
	mix: 1,
};

/**
 * Audio engine using Web Audio API for EQ and compression.
 *
 * KEY DESIGN: Audio is NOT captured by Web Audio until effects are enabled.
 * This avoids the CORS/crossOrigin issues that cause silence when
 * createMediaElementSource is used with HLS.js MediaSource.
 *
 * When no effects are enabled, the video plays audio natively (no Web Audio).
 * When EQ or compressor is enabled, we capture audio via createMediaElementSource
 * and route it through the effects chain.
 */
export class AudioEngine {
	private ctx: AudioContext | null = null;
	private source: MediaElementAudioSourceNode | null = null;
	private inputGainNode: GainNode | null = null;
	private filters: BiquadFilterNode[] = [];
	private compressor: DynamicsCompressorNode | null = null;
	private makeupGainNode: GainNode | null = null;
	private dryGainNode: GainNode | null = null;
	private wetGainNode: GainNode | null = null;
	private compMergeNode: GainNode | null = null;
	private eqEnabled = false;
	private compressorEnabled = false;
	private inputGainDb = 0;
	private currentBands: EqBand[] = [...DEFAULT_EQ_BANDS];
	private currentCompressor: CompressorSettings = { ...DEFAULT_COMPRESSOR };
	private currentElement: HTMLMediaElement | null = null;
	private captured = false;

	/**
	 * Register the video element. Does NOT capture audio yet.
	 * Audio plays natively until effects are enabled.
	 */
	attach(element: HTMLMediaElement): void {
		this.currentElement = element;
		// If effects are already enabled (restored from settings), capture now
		if (this.eqEnabled || this.compressorEnabled) {
			this.captureAudio();
		}
	}

	isAttached(): boolean {
		return this.currentElement !== null;
	}

	/**
	 * Ensure AudioContext exists and is running.
	 * Call from user gesture handlers.
	 */
	ensureContext(): void {
		if (!this.ctx) {
			this.ctx = new AudioContext();
		}
		if (this.ctx.state === 'suspended') {
			this.ctx.resume().catch(() => {});
		}
	}

	setEqEnabled(enabled: boolean): void {
		this.eqEnabled = enabled;
		if (enabled && !this.captured) {
			this.captureAudio();
		} else if (!enabled && !this.compressorEnabled && this.captured) {
			// Both effects off — release audio back to native playback
			this.releaseAudio();
		} else {
			this.rebuildChain();
		}
	}

	setCompressorEnabled(enabled: boolean): void {
		this.compressorEnabled = enabled;
		if (enabled && !this.captured) {
			this.captureAudio();
		} else if (!enabled && !this.eqEnabled && this.captured) {
			// Both effects off — release audio back to native playback
			this.releaseAudio();
		} else {
			if (!enabled) {
				if (this.dryGainNode) this.dryGainNode.gain.value = 1;
				if (this.wetGainNode) this.wetGainNode.gain.value = 0;
			}
			this.rebuildChain();
			if (enabled) {
				this.applyMix(this.currentCompressor.mix);
				this.applyCompressorSettings(this.currentCompressor);
			}
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

	setBands(bands: EqBand[]): void {
		this.currentBands = bands;
		for (let i = 0; i < bands.length && i < this.filters.length; i++) {
			const filter = this.filters[i]!;
			const band = bands[i]!;
			filter.type = band.type;
			filter.frequency.value = band.frequency;
			filter.gain.value = band.gain;
			filter.Q.value = band.q;
		}
	}

	getBands(): EqBand[] {
		return [...this.currentBands];
	}

	setCompressorSettings(s: CompressorSettings): void {
		this.currentCompressor = { ...s };
		this.applyCompressorSettings(s);
		if (this.makeupGainNode) {
			this.makeupGainNode.gain.value = this.dbToLinear(s.makeupGain);
		}
		this.applyMix(s.mix);
	}

	getCompressorSettings(): CompressorSettings {
		return { ...this.currentCompressor };
	}

	async resume(): Promise<void> {
		if (this.ctx?.state === 'suspended') {
			try {
				await this.ctx.resume();
			} catch {}
		}
	}

	destroy(): void {
		this.releaseAudio();
		if (this.ctx) {
			this.ctx.close().catch(() => {});
			this.ctx = null;
		}
		this.currentElement = null;
	}

	// ── Private: Capture/Release ──

	/**
	 * Capture audio from the video element via Web Audio API.
	 * Once captured, audio MUST go through the AudioContext to be heard.
	 */
	private captureAudio(): void {
		if (this.captured || !this.currentElement) return;

		if (!this.ctx) {
			this.ctx = new AudioContext();
		}

		try {
			this.source = this.ctx.createMediaElementSource(this.currentElement);
		} catch (err) {
			console.warn('[AudioEngine] createMediaElementSource failed:', err);
			return;
		}

		// Create nodes
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

		this.compressor = this.ctx.createDynamicsCompressor();
		this.applyCompressorSettings(this.currentCompressor);

		this.makeupGainNode = this.ctx.createGain();
		this.makeupGainNode.gain.value = this.dbToLinear(this.currentCompressor.makeupGain);

		this.dryGainNode = this.ctx.createGain();
		this.wetGainNode = this.ctx.createGain();
		this.compMergeNode = this.ctx.createGain();
		this.applyMix(this.currentCompressor.mix);

		this.captured = true;
		this.rebuildChain();

		// Resume context if needed
		if (this.ctx.state === 'suspended') {
			this.ctx.resume().catch(() => {});
		}

		console.log('[AudioEngine] Audio captured via Web Audio API');
	}

	/**
	 * Release audio back to native video playback.
	 * Note: createMediaElementSource is permanent — once called, audio
	 * always goes through Web Audio. So we just route source → destination
	 * (pass-through) when no effects are active.
	 */
	private releaseAudio(): void {
		if (!this.captured || !this.source || !this.ctx) return;

		// Disconnect everything and connect source directly to destination
		this.source.disconnect();
		this.inputGainNode?.disconnect();
		for (const f of this.filters) f.disconnect();
		this.compressor?.disconnect();
		this.makeupGainNode?.disconnect();
		this.dryGainNode?.disconnect();
		this.wetGainNode?.disconnect();
		this.compMergeNode?.disconnect();

		// Pass-through: source → destination (no effects)
		this.source.connect(this.ctx.destination);
		console.log('[AudioEngine] Effects bypassed, pass-through mode');
	}

	// ── Private: Chain ──

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

		let current: AudioNode = this.source;

		if (this.eqEnabled && this.inputGainNode) {
			current.connect(this.inputGainNode);
			current = this.inputGainNode;
		}

		if (this.eqEnabled && this.filters.length > 0) {
			for (const filter of this.filters) {
				current.connect(filter);
				current = filter;
			}
		}

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
		}

		current.connect(this.ctx.destination);
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
		if (!this.dryGainNode || !this.wetGainNode) return;
		this.dryGainNode.gain.value = 1 - mix;
		this.wetGainNode.gain.value = mix;
	}

	private dbToLinear(db: number): number {
		return 10 ** (db / 20);
	}
}

export const audioEngine = new AudioEngine();

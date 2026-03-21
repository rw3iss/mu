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
	private attached = false;
	private currentElement: HTMLMediaElement | null = null;

	/**
	 * Ensure the AudioContext exists. Call this from a user gesture (click handler)
	 * so Chrome allows the context to run. Safe to call multiple times.
	 */
	ensureContext(): void {
		if (!this.ctx) {
			this.ctx = new AudioContext();
			console.log('[AudioEngine] Created AudioContext, state:', this.ctx.state);
		}
		if (this.ctx.state === 'suspended') {
			this.ctx.resume().then(() => {
				console.log('[AudioEngine] AudioContext resumed, state:', this.ctx?.state);
			}).catch((err) => {
				console.warn('[AudioEngine] Failed to resume AudioContext:', err);
			});
		} else {
			console.log('[AudioEngine] AudioContext already running, state:', this.ctx.state);
		}
	}

	/**
	 * Attach to a video/audio element. Creates the source node and audio chain.
	 * Call ensureContext() first (from a user gesture) to avoid suspended state.
	 */
	attach(element: HTMLMediaElement): void {
		// Same element — nothing to do
		if (this.attached && this.currentElement === element) {
			console.log('[AudioEngine] attach: same element, skipping');
			return;
		}

		// Create context if not exists (fallback — may start suspended)
		if (!this.ctx) {
			this.ctx = new AudioContext();
			console.log('[AudioEngine] attach: created fallback AudioContext, state:', this.ctx.state);
		}

		if (this.attached && this.source) {
			// Re-attaching to a new video element — swap source only
			console.log('[AudioEngine] attach: re-attaching to new element');
			this.source.disconnect();
			try {
				this.source = this.ctx.createMediaElementSource(element);
			} catch (err) {
				console.error('[AudioEngine] attach: createMediaElementSource failed:', err);
				return;
			}
			this.currentElement = element;
			this.rebuildChain();
			console.log('[AudioEngine] attach: re-attached, ctx state:', this.ctx.state);
			return;
		}

		// First attach — create everything
		console.log('[AudioEngine] attach: first attach');
		try {
			this.source = this.ctx.createMediaElementSource(element);
		} catch (err) {
			console.error('[AudioEngine] attach: createMediaElementSource failed:', err);
			return;
		}
		this.currentElement = element;

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

		this.attached = true;
		this.rebuildChain();
	}

	isAttached(): boolean {
		return this.attached;
	}

	setEqEnabled(enabled: boolean): void {
		this.eqEnabled = enabled;
		this.rebuildChain();
	}

	setCompressorEnabled(enabled: boolean): void {
		this.compressorEnabled = enabled;
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
			} catch {
				// Browser blocked resume — will retry on next user interaction
			}
		}
	}

	destroy(): void {
		if (this.source) {
			this.source.disconnect();
			this.source = null;
		}
		if (this.ctx) {
			this.ctx.close().catch(() => {});
			this.ctx = null;
		}
		this.inputGainNode = null;
		this.filters = [];
		this.compressor = null;
		this.makeupGainNode = null;
		this.dryGainNode = null;
		this.wetGainNode = null;
		this.compMergeNode = null;
		this.currentElement = null;
		this.attached = false;
	}

	// ── Private ──

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

		// Build chain: source → [inputGain] → [EQ] → [Compressor w/ dry/wet mix] → destination
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
			// Parallel compression: split into dry + wet, merge at compMergeNode
			current.connect(this.dryGainNode);
			this.dryGainNode.connect(this.compMergeNode);
			current.connect(this.compressor);
			this.compressor.connect(this.makeupGainNode);
			this.makeupGainNode.connect(this.wetGainNode);
			this.wetGainNode.connect(this.compMergeNode);

			current = this.compMergeNode;
		}

		current.connect(this.ctx.destination);
		console.log('[AudioEngine] rebuildChain: eq=%s, comp=%s, ctx.state=%s',
			this.eqEnabled, this.compressorEnabled, this.ctx.state);
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

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

	/**
	 * Attach to a video/audio element.
	 *
	 * Idempotent: calling with the same element is a no-op. Calling with a
	 * different element logs a warning and is refused — browsers permanently
	 * bind a `MediaElementSourceNode` to its element, so the only way to
	 * "re-attach" to a new element is to destroy() the engine first. The
	 * caller should ensure the video element is a singleton for the app
	 * lifetime.
	 */
	attach(element: HTMLMediaElement): void {
		if (this.attached) {
			if (this.boundElement !== element) {
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
			this.ctx = new AudioContext();
			this.source = this.ctx.createMediaElementSource(element);
			this.boundElement = element;
		} catch (err) {
			console.error('[audioEngine] Failed to create MediaElementSource:', err);
			this.ctx = null;
			this.source = null;
			this.boundElement = null;
			return;
		}

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
		this.boundElement = null;
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

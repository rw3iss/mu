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
};

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private source: MediaElementAudioSourceNode | null = null;
	private filters: BiquadFilterNode[] = [];
	private compressor: DynamicsCompressorNode | null = null;
	private makeupGainNode: GainNode | null = null;
	private eqEnabled = false;
	private compressorEnabled = false;
	private currentBands: EqBand[] = [...DEFAULT_EQ_BANDS];
	private currentCompressor: CompressorSettings = { ...DEFAULT_COMPRESSOR };
	private attached = false;

	/**
	 * Attach to a video/audio element. Call once — the source node is
	 * permanently bound to the element (Web Audio API limitation).
	 */
	attach(element: HTMLMediaElement): void {
		if (this.attached) return;

		this.ctx = new AudioContext();
		this.source = this.ctx.createMediaElementSource(element);

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
		this.rebuildChain();
	}

	getEqEnabled(): boolean {
		return this.eqEnabled;
	}

	getCompressorEnabled(): boolean {
		return this.compressorEnabled;
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

	/** Resume AudioContext if suspended (browser autoplay policy). */
	async resume(): Promise<void> {
		if (this.ctx?.state === 'suspended') {
			await this.ctx.resume();
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
		this.filters = [];
		this.compressor = null;
		this.makeupGainNode = null;
		this.attached = false;
	}

	// ── Private ──

	private rebuildChain(): void {
		if (!this.ctx || !this.source) return;

		// Disconnect everything
		this.source.disconnect();
		for (const f of this.filters) f.disconnect();
		this.compressor?.disconnect();
		this.makeupGainNode?.disconnect();

		// Build chain based on what's enabled
		let current: AudioNode = this.source;

		if (this.eqEnabled && this.filters.length > 0) {
			for (const filter of this.filters) {
				current.connect(filter);
				current = filter;
			}
		}

		if (this.compressorEnabled && this.compressor && this.makeupGainNode) {
			current.connect(this.compressor);
			this.compressor.connect(this.makeupGainNode);
			current = this.makeupGainNode;
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

	private dbToLinear(db: number): number {
		return Math.pow(10, db / 20);
	}
}

/** Singleton audio engine instance shared across the app. */
export const audioEngine = new AudioEngine();

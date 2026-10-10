/**
 * Streaming peak reducer for the waveform seek bar. Fed little-endian signed
 * 16-bit mono PCM in arbitrary chunks; keeps one running max per bucket, so a
 * long track never needs its whole decode in memory.
 */
export class PeakReducer {
	private readonly peaks: number[];
	private bucket = 0;
	private inBucket = 0;
	private current = 0;
	private carry: number | null = null;

	constructor(
		private readonly bucketCount: number,
		private readonly samplesPerBucket: number,
	) {
		this.peaks = new Array(bucketCount).fill(0);
	}

	push(chunk: Uint8Array): void {
		let i = 0;
		if (this.carry != null && chunk.length > 0) {
			this.sample(((chunk[0]! << 8) | this.carry) << 16 >> 16);
			this.carry = null;
			i = 1;
		}
		for (; i + 1 < chunk.length; i += 2) {
			this.sample(((chunk[i + 1]! << 8) | chunk[i]!) << 16 >> 16);
		}
		if (i < chunk.length) this.carry = chunk[i]!;
	}

	private sample(v: number): void {
		const a = v < 0 ? -v : v;
		if (a > this.current) this.current = a;
		if (++this.inBucket >= this.samplesPerBucket) this.flush();
	}

	private flush(): void {
		if (this.bucket < this.bucketCount) this.peaks[this.bucket] = this.current / 32768;
		this.bucket++;
		this.inBucket = 0;
		this.current = 0;
	}

	/** Normalised 0..1 peaks, scaled so the loudest bucket reaches 1. */
	finish(): number[] {
		if (this.inBucket > 0) this.flush();
		const max = Math.max(...this.peaks, 1e-6);
		return this.peaks.map((p) => Math.round((p / max) * 1000) / 1000);
	}
}

/** Bucket count for a track: ~4 per second, clamped to [300, 2400]. */
export function waveformBucketCount(durationSeconds: number): number {
	return Math.min(2400, Math.max(300, Math.round(durationSeconds * 4)));
}

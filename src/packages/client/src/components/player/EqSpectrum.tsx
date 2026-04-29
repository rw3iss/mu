import { audioEngine } from '@/audio/audio-engine';
import { useCanvasAnimator } from '@/hooks/useCanvasAnimator';
import styles from './EqSpectrum.module.scss';

/**
 * Real-time spectrum display sized to the EQ slider grid.
 *
 * The grid has 11 columns (Amp + 10 frequency bands). The 10 EQ-band
 * frequencies are 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz.
 * We sample 19 log-spaced points: every band frequency plus a geometric
 * midpoint between each adjacent pair. The X position of sample j is
 * placed at the canvas X corresponding to grid column (j * 0.5) past Amp,
 * so band frequencies land directly on slider centers and midpoints land
 * halfway between sliders.
 */

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

// 19 sample frequencies: bands + midpoints (geometric mean).
const SAMPLE_FREQS: number[] = (() => {
	const arr: number[] = [];
	for (let i = 0; i < EQ_FREQS.length; i++) {
		arr.push(EQ_FREQS[i]!);
		if (i < EQ_FREQS.length - 1) {
			arr.push(Math.sqrt(EQ_FREQS[i]! * EQ_FREQS[i + 1]!));
		}
	}
	return arr; // length 19
})();

// X position for sample j as a fraction of canvas width.
// Amp column = column 0, band-i = column i+1, midpoint between
// band-i and band-(i+1) = column i+1.5. With 11 columns (each 1/11 wide),
// center of column c = (c + 0.5)/11.
const SAMPLE_X_FRAC: number[] = SAMPLE_FREQS.map((_, j) => {
	const col = 1 + j * 0.5;
	return (col + 0.5) / 11;
});

export function EqSpectrum() {
	const canvasRef = useCanvasAnimator(() => {
		const fftSize = audioEngine.getFftSize() || 4096;
		const sampleRate = audioEngine.getSampleRate();
		const binCount = fftSize / 2;
		const binHz = sampleRate / fftSize;
		const data = new Uint8Array(binCount);

		// Pre-compute the FFT-bin window for each sample frequency. Each
		// sample averages bins between the geometric midpoints of its
		// neighbours, capped to [0, binCount-1].
		const sampleBinRanges: { lo: number; hi: number }[] = SAMPLE_FREQS.map((f, j) => {
			const fLo = j === 0 ? f / Math.SQRT2 : Math.sqrt(f * SAMPLE_FREQS[j - 1]!);
			const fHi =
				j === SAMPLE_FREQS.length - 1
					? f * Math.SQRT2
					: Math.sqrt(f * SAMPLE_FREQS[j + 1]!);
			const lo = Math.max(0, Math.min(binCount - 1, Math.round(fLo / binHz)));
			const hi = Math.max(lo, Math.min(binCount - 1, Math.round(fHi / binHz)));
			return { lo, hi };
		});
		const mags: number[] = new Array(SAMPLE_FREQS.length);

		return (ctx, w, h) => {
			const ok = audioEngine.getFrequencyData(data);
			ctx.clearRect(0, 0, w, h);
			if (!ok) return;

			for (let j = 0; j < SAMPLE_FREQS.length; j++) {
				const { lo, hi } = sampleBinRanges[j]!;
				let sum = 0;
				for (let b = lo; b <= hi; b++) sum += data[b]!;
				mags[j] = sum / (hi - lo + 1) / 255;
			}

			const firstY = h - mags[0]! * h;
			const lastY = h - mags[mags.length - 1]! * h;

			ctx.beginPath();
			ctx.moveTo(0, h);
			ctx.lineTo(0, firstY);
			ctx.lineTo(SAMPLE_X_FRAC[0]! * w, firstY);
			for (let j = 1; j < mags.length; j++) {
				ctx.lineTo(SAMPLE_X_FRAC[j]! * w, h - mags[j]! * h);
			}
			ctx.lineTo(w, lastY);
			ctx.lineTo(w, h);
			ctx.closePath();

			const grad = ctx.createLinearGradient(0, 0, 0, h);
			grad.addColorStop(0, 'rgba(99, 102, 241, 0.55)');
			grad.addColorStop(1, 'rgba(99, 102, 241, 0.05)');
			ctx.fillStyle = grad;
			ctx.fill();

			ctx.beginPath();
			ctx.moveTo(0, firstY);
			ctx.lineTo(SAMPLE_X_FRAC[0]! * w, firstY);
			for (let j = 1; j < mags.length; j++) {
				ctx.lineTo(SAMPLE_X_FRAC[j]! * w, h - mags[j]! * h);
			}
			ctx.lineTo(w, lastY);
			ctx.strokeStyle = 'rgba(129, 140, 248, 0.9)';
			ctx.lineWidth = 1.5;
			ctx.stroke();
		};
	});

	return <canvas ref={canvasRef} class={styles.canvas} />;
}

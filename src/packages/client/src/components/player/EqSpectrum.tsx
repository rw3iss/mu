import { useEffect, useRef } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
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
	const col = 1 + j * 0.5; // band 0 at col 1, midpoint 0 at col 1.5, ...
	return (col + 0.5) / 11;
});

export function EqSpectrum() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx2d = canvas.getContext('2d');
		if (!ctx2d) return;

		// Resize canvas to its rendered size for crisp drawing on HiDPI.
		const resize = () => {
			const dpr = window.devicePixelRatio || 1;
			const { clientWidth, clientHeight } = canvas;
			canvas.width = Math.max(1, Math.floor(clientWidth * dpr));
			canvas.height = Math.max(1, Math.floor(clientHeight * dpr));
			ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(canvas);

		const fftSize = audioEngine.getFftSize() || 4096;
		const sampleRate = audioEngine.getSampleRate();
		const binCount = fftSize / 2;
		const binHz = sampleRate / fftSize;
		const data = new Uint8Array(binCount);

		// Pre-compute the FFT-bin window for each sample frequency so the
		// rAF loop has zero allocation. Each sample averages bins between
		// the geometric midpoints of its neighbours, capped to [0, binCount-1].
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

		const draw = () => {
			rafRef.current = requestAnimationFrame(draw);
			const ok = audioEngine.getFrequencyData(data);
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			ctx2d.clearRect(0, 0, w, h);
			if (!ok) return;

			// Compute magnitude for each sample frequency by averaging the
			// FFT bins covering it, then normalise 0..255 → 0..1.
			const mags: number[] = new Array(SAMPLE_FREQS.length);
			for (let j = 0; j < SAMPLE_FREQS.length; j++) {
				const { lo, hi } = sampleBinRanges[j]!;
				let sum = 0;
				for (let b = lo; b <= hi; b++) sum += data[b]!;
				mags[j] = sum / (hi - lo + 1) / 255;
			}

			// Filled area path: edge points pinned to bottom corners so the
			// fill closes cleanly along the canvas baseline.
			ctx2d.beginPath();
			ctx2d.moveTo(0, h);
			ctx2d.lineTo(SAMPLE_X_FRAC[0]! * w, h - mags[0]! * h);
			for (let j = 1; j < mags.length; j++) {
				ctx2d.lineTo(SAMPLE_X_FRAC[j]! * w, h - mags[j]! * h);
			}
			ctx2d.lineTo(w, h);
			ctx2d.closePath();

			// Accent-coloured fill, alpha so the slider thumbs read on top.
			const grad = ctx2d.createLinearGradient(0, 0, 0, h);
			grad.addColorStop(0, 'rgba(99, 102, 241, 0.55)');
			grad.addColorStop(1, 'rgba(99, 102, 241, 0.05)');
			ctx2d.fillStyle = grad;
			ctx2d.fill();

			// Crisp top line.
			ctx2d.beginPath();
			ctx2d.moveTo(SAMPLE_X_FRAC[0]! * w, h - mags[0]! * h);
			for (let j = 1; j < mags.length; j++) {
				ctx2d.lineTo(SAMPLE_X_FRAC[j]! * w, h - mags[j]! * h);
			}
			ctx2d.strokeStyle = 'rgba(129, 140, 248, 0.9)';
			ctx2d.lineWidth = 1.5;
			ctx2d.stroke();
		};
		rafRef.current = requestAnimationFrame(draw);

		return () => {
			ro.disconnect();
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		};
	}, []);

	return <canvas ref={canvasRef} class={styles.canvas} />;
}

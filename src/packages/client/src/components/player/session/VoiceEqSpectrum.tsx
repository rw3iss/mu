import { micAudioEngine } from '@/audio/mic-audio-engine';
import { useCanvasAnimator } from '@/hooks/useCanvasAnimator';
import styles from './VoicePanel.module.scss';

/**
 * Real-time mic spectrum for the Voice Audio panel — a mic-bound copy of the
 * playback `EqSpectrum`, reading {@link micAudioEngine} instead of the movie
 * `audioEngine`. Sized to the same 11-column EQ slider grid.
 */

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

const SAMPLE_FREQS: number[] = (() => {
	const arr: number[] = [];
	for (let i = 0; i < EQ_FREQS.length; i++) {
		arr.push(EQ_FREQS[i]!);
		if (i < EQ_FREQS.length - 1) {
			arr.push(Math.sqrt(EQ_FREQS[i]! * EQ_FREQS[i + 1]!));
		}
	}
	return arr;
})();

const SAMPLE_X_FRAC: number[] = SAMPLE_FREQS.map((_, j) => {
	const col = 1 + j * 0.5;
	return (col + 0.5) / 11;
});

export function VoiceEqSpectrum() {
	const canvasRef = useCanvasAnimator(() => {
		const fftSize = micAudioEngine.getFftSize() || 4096;
		const sampleRate = micAudioEngine.getSampleRate();
		const binCount = fftSize / 2;
		const binHz = sampleRate / fftSize;
		const data = new Uint8Array(binCount);

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
			const ok = micAudioEngine.getFrequencyData(data);
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

	return <canvas ref={canvasRef} class={styles.visualizerCanvas} />;
}

import { audioEngine } from '@/audio/audio-engine';
import { useCanvasAnimator } from '@/hooks/useCanvasAnimator';
import { compressorSettings } from '@/state/audio-effects.state';
import styles from './CompressorCurve.module.scss';

/**
 * Live compressor transfer-curve display.
 *
 * Layers (back-to-front):
 *  - 1:1 reference line (dashed, faint white) — what "no compression"
 *    looks like.
 *  - Knee region (orange tinted band) — the soft transition zone
 *    between threshold-K/2 and threshold+K/2.
 *  - Threshold vertical line (orange) — at x = threshold dB.
 *  - Compression curve (indigo) — input -> output transfer function
 *    using the same soft-knee math the Web Audio compressor uses.
 *  - Live input vertical (green, dim) — current peak input level.
 *  - Live signal dot (green, bright) — moving point on the curve at
 *    (input_dB, compress(input_dB)). Where the music currently sits.
 *  - Gain reduction bar (right edge, red) — actual reduction the
 *    compressor is applying right now (accounting for attack/release),
 *    so transients show up here even when the dot is steady.
 *
 * Axes:
 *   X = -60 dB ... 0 dB (input)
 *   Y = -60 dB ... +12 dB (output, allowing makeup gain to lift the
 *       curve into the +y region without clipping).
 */

const MIN_DB_X = -60;
const MAX_DB_X = 0;
const MIN_DB_Y = -60;
const MAX_DB_Y = 12;

function compressDb(x: number, T: number, R: number, K: number, M: number): number {
	let out: number;
	const kneeLo = T - K / 2;
	const kneeHi = T + K / 2;
	if (K === 0) {
		out = x < T ? x : T + (x - T) / R;
	} else if (x < kneeLo) {
		out = x;
	} else if (x > kneeHi) {
		out = T + (x - T) / R;
	} else {
		// Soft-knee quadratic: continuous in value and first derivative
		// at both knee boundaries, joining slope=1 to slope=1/R smoothly.
		const d = x - kneeLo;
		out = x + ((1 / R - 1) * d * d) / (2 * K);
	}
	return out + M;
}

const dbToX = (db: number, w: number) => ((db - MIN_DB_X) / (MAX_DB_X - MIN_DB_X)) * w;
const dbToY = (db: number, h: number) => h - ((db - MIN_DB_Y) / (MAX_DB_Y - MIN_DB_Y)) * h;

export function CompressorCurve() {
	const canvasRef = useCanvasAnimator(() => {
		const fftSize = audioEngine.getFftSize() || 4096;
		const timeBuffer = new Uint8Array(fftSize);
		// Smooth the displayed input so the dot doesn't jitter on every
		// audio buffer; meter ballistics ~50ms attack / 200ms release.
		let smoothedDb = MIN_DB_X;

		return (ctx, w, h) => {
			ctx.clearRect(0, 0, w, h);

			const s = compressorSettings.value;
			const T = s.threshold;
			const R = Math.max(1, s.ratio);
			const K = Math.max(0, s.knee);
			const M = s.makeupGain;

			const x0 = dbToX(MIN_DB_X, w);
			const xT = dbToX(T, w);
			const xKneeLo = dbToX(T - K / 2, w);
			const xKneeHi = dbToX(T + K / 2, w);
			const xMax = dbToX(MAX_DB_X, w);

			// 1:1 reference line (no compression) — dashed.
			ctx.save();
			ctx.setLineDash([4, 4]);
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(dbToX(MIN_DB_X, w), dbToY(MIN_DB_X, h));
			ctx.lineTo(dbToX(0, w), dbToY(0, h));
			ctx.stroke();
			ctx.restore();

			// Knee region: tinted band between knee_lo and knee_hi.
			if (K > 0 && xKneeHi > xKneeLo) {
				ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
				ctx.fillRect(xKneeLo, 0, xKneeHi - xKneeLo, h);
			}

			// Threshold line.
			ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(xT, 0);
			ctx.lineTo(xT, h);
			ctx.stroke();

			// Compression curve fill (faint area below curve).
			const steps = 80;
			const curvePoints: { x: number; y: number }[] = new Array(steps + 1);
			for (let i = 0; i <= steps; i++) {
				const inDb = MIN_DB_X + ((MAX_DB_X - MIN_DB_X) * i) / steps;
				const outDb = compressDb(inDb, T, R, K, M);
				curvePoints[i] = { x: dbToX(inDb, w), y: dbToY(outDb, h) };
			}

			ctx.beginPath();
			ctx.moveTo(x0, h);
			for (const p of curvePoints) ctx.lineTo(p.x, p.y);
			ctx.lineTo(xMax, h);
			ctx.closePath();
			const grad = ctx.createLinearGradient(0, 0, 0, h);
			grad.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
			grad.addColorStop(1, 'rgba(99, 102, 241, 0.04)');
			ctx.fillStyle = grad;
			ctx.fill();

			// Compression curve line.
			ctx.beginPath();
			for (let i = 0; i < curvePoints.length; i++) {
				const p = curvePoints[i]!;
				if (i === 0) ctx.moveTo(p.x, p.y);
				else ctx.lineTo(p.x, p.y);
			}
			ctx.strokeStyle = 'rgba(129, 140, 248, 0.95)';
			ctx.lineWidth = 1.75;
			ctx.stroke();

			// --- live signal -----------------------------------------------------
			const ok = audioEngine.getTimeDomainData(timeBuffer);
			let peak = 0;
			if (ok) {
				for (let i = 0; i < timeBuffer.length; i++) {
					const v = Math.abs(timeBuffer[i]! - 128) / 128;
					if (v > peak) peak = v;
				}
			}
			const rawDb = peak > 0 ? 20 * Math.log10(peak) : MIN_DB_X;
			const targetDb = Math.max(MIN_DB_X, Math.min(MAX_DB_X, rawDb));
			// Asymmetric smoothing — quick attack, slower release.
			const alpha = targetDb > smoothedDb ? 0.5 : 0.1;
			smoothedDb = smoothedDb + (targetDb - smoothedDb) * alpha;

			if (smoothedDb > MIN_DB_X + 1) {
				const inDb = smoothedDb;
				const outDb = compressDb(inDb, T, R, K, M);
				const lx = dbToX(inDb, w);
				const ly = dbToY(outDb, h);

				// Vertical guide from x-axis to dot.
				ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(lx, h);
				ctx.lineTo(lx, ly);
				ctx.stroke();

				// Horizontal guide from y-axis to dot.
				ctx.beginPath();
				ctx.moveTo(0, ly);
				ctx.lineTo(lx, ly);
				ctx.stroke();

				// Live dot.
				ctx.fillStyle = 'rgba(34, 197, 94, 0.95)';
				ctx.beginPath();
				ctx.arc(lx, ly, 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
				ctx.lineWidth = 1;
				ctx.stroke();
			}

			// --- gain reduction bar (right edge) ---------------------------------
			// reduction is negative dB (0 = none, -10 = -10dB of GR).
			const reduction = audioEngine.getCompressorReduction();
			const grPx = Math.min(h, (Math.abs(reduction) / 24) * h);
			if (grPx > 0.5) {
				const barW = 6;
				const barX = w - barW - 2;
				ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
				ctx.fillRect(barX, 0, barW, h);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.75)';
				ctx.fillRect(barX, 0, barW, grPx);
			}
		};
	});

	return <canvas ref={canvasRef} class={styles.canvas} />;
}

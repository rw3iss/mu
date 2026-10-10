import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { musicService } from '@/services/music.service';
import { currentTrack } from '@/state/musicPlayer.state';
import { currentTime, duration } from '@/state/player.state';
import pcStyles from '../PlayerControls.module.scss';
import { formatTime } from './formatTime';
import type { ControlGroupProps } from './types';
import styles from './WaveformSeekBar.module.scss';

/** Bar geometry in CSS px. */
const BAR_W = 2;
const BAR_STEP = 3;
const DRAG_THROTTLE_MS = 15;
const KEY_STEP = 5;

/** Peaks per track file. `null` = request failed / no data (plain bar). */
const peaksCache = new Map<string, number[] | null>();

/** Max-pool the server peaks into `n` bars. */
function bucket(peaks: number[], n: number): Float32Array {
	const out = new Float32Array(n);
	const len = peaks.length;
	for (let i = 0; i < n; i++) {
		const start = Math.floor((i * len) / n);
		const end = Math.max(start + 1, Math.floor(((i + 1) * len) / n));
		let max = 0;
		for (let j = start; j < end && j < len; j++) {
			const v = peaks[j]!;
			if (v > max) max = v;
		}
		out[i] = Math.min(1, max);
	}
	return out;
}

/**
 * Audio seek bar drawn from the server's precomputed waveform peaks. The
 * played part is in the accent colour; hover shows the time; click / drag /
 * arrow keys seek. While the peaks load (or if the request fails) it draws a
 * plain progress bar. HiDPI aware; redraws on resize.
 */
export function WaveformSeekBar({ onSeek, hasMiniThumbnail }: ControlGroupProps) {
	const fileId = currentTrack.value?.session?.trackFileId ?? null;
	const [peaks, setPeaks] = useState<number[] | null>(() =>
		fileId ? (peaksCache.get(fileId) ?? null) : null,
	);
	const wrapRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const accentRef = useRef('#06b6d4');
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const lastDragSeek = useRef(0);

	// ── Peaks ──
	useEffect(() => {
		if (!fileId) {
			setPeaks(null);
			return;
		}
		if (peaksCache.has(fileId)) {
			setPeaks(peaksCache.get(fileId) ?? null);
			return;
		}
		setPeaks(null);
		let cancelled = false;
		musicService
			.waveform(fileId)
			.then((w) => {
				const p = w?.peaks?.length ? w.peaks : null;
				peaksCache.set(fileId, p);
				if (!cancelled) setPeaks(p);
			})
			.catch(() => {
				peaksCache.set(fileId, null);
				if (!cancelled) setPeaks(null);
			});
		return () => {
			cancelled = true;
		};
	}, [fileId]);

	// ── Size ──
	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const measure = () => {
			const r = el.getBoundingClientRect();
			setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
			const accent = getComputedStyle(el).getPropertyValue('--color-accent').trim();
			if (accent) accentRef.current = accent;
		};
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const bars = useMemo(() => {
		if (!peaks || size.w <= 0) return null;
		return bucket(peaks, Math.max(1, Math.floor(size.w / BAR_STEP)));
	}, [peaks, size.w]);

	const total = duration.value;
	const progress = total > 0 ? Math.min(1, currentTime.value / total) : 0;

	// ── Draw ──
	useEffect(() => {
		const canvas = canvasRef.current;
		const { w, h } = size;
		if (!canvas || w <= 0 || h <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		const pw = Math.round(w * dpr);
		const ph = Math.round(h * dpr);
		if (canvas.width !== pw) canvas.width = pw;
		if (canvas.height !== ph) canvas.height = ph;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		const accent = accentRef.current;
		const base = 'rgba(255, 255, 255, 0.3)';
		const hoverCol = 'rgba(255, 255, 255, 0.6)';
		const playedX = progress * w;
		const hoverX = hover?.x ?? -1;

		if (!bars) {
			const barH = 3;
			const y = Math.round((h - barH) / 2);
			ctx.fillStyle = base;
			ctx.fillRect(0, y, w, barH);
			if (hoverX > 0) {
				ctx.fillStyle = hoverCol;
				ctx.fillRect(0, y, hoverX, barH);
			}
			ctx.fillStyle = accent;
			ctx.fillRect(0, y, playedX, barH);
			return;
		}
		for (let i = 0; i < bars.length; i++) {
			const x = i * BAR_STEP;
			const bh = Math.max(2, bars[i]! * h);
			const y = (h - bh) / 2;
			ctx.fillStyle = x < playedX ? accent : x < hoverX ? hoverCol : base;
			ctx.fillRect(x, y, BAR_W, bh);
		}
	}, [bars, size, progress, hover]);

	// ── Interaction ──
	const timeAt = useCallback((clientX: number): number | null => {
		const el = wrapRef.current;
		const d = duration.value;
		if (!el || !(d > 0)) return null;
		const r = el.getBoundingClientRect();
		const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
		return frac * d;
	}, []);

	const updateHover = (clientX: number) => {
		const el = wrapRef.current;
		const t = timeAt(clientX);
		if (!el || t == null) return;
		const r = el.getBoundingClientRect();
		setHover({ x: Math.max(0, Math.min(r.width, clientX - r.left)), time: t });
	};

	const onPointerDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		setDragging(true);
		lastDragSeek.current = 0;
		const t = timeAt(e.clientX);
		if (t != null) onSeek(t);
	};

	const onPointerMove = (e: PointerEvent) => {
		updateHover(e.clientX);
		if (!dragging) return;
		const now = performance.now();
		if (now - lastDragSeek.current < DRAG_THROTTLE_MS) return;
		lastDragSeek.current = now;
		const t = timeAt(e.clientX);
		if (t != null) onSeek(t);
	};

	const onPointerUp = (e: PointerEvent) => {
		if (!dragging) return;
		setDragging(false);
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		const t = timeAt(e.clientX);
		if (t != null) onSeek(t);
	};

	const onKeyDown = (e: KeyboardEvent) => {
		const d = duration.value;
		let target: number | null = null;
		const step = e.shiftKey ? KEY_STEP * 6 : KEY_STEP;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = currentTime.value - step;
		else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = currentTime.value + step;
		else if (e.key === 'Home') target = 0;
		else if (e.key === 'End') target = Math.max(0, d - 1);
		if (target == null) return;
		// Keep the global player shortcut from seeking a second time.
		e.preventDefault();
		e.stopPropagation();
		onSeek(Math.max(0, Math.min(d || target, target)));
	};

	return (
		<div
			ref={wrapRef}
			class={`${styles.waveform} ${hasMiniThumbnail ? styles.mini : ''} ${
				dragging ? styles.dragging : ''
			}`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerLeave={() => {
				if (!dragging) setHover(null);
			}}
			onKeyDown={onKeyDown}
			tabIndex={0}
			role="slider"
			aria-label="Seek"
			aria-valuemin={0}
			aria-valuemax={Math.round(total)}
			aria-valuenow={Math.round(currentTime.value)}
			aria-valuetext={`${formatTime(currentTime.value)} of ${formatTime(total)}`}
		>
			<canvas ref={canvasRef} class={styles.canvas} />
			{hover && (
				<div class={pcStyles.seekTooltip} style={{ left: `${hover.x}px` }}>
					{formatTime(hover.time)}
				</div>
			)}
		</div>
	);
}

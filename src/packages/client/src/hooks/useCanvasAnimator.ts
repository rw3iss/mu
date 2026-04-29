import { useEffect, useRef } from 'preact/hooks';

export type CanvasDrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * HiDPI-aware canvas tied to a requestAnimationFrame loop.
 *
 * `init` runs once after the canvas mounts and returns the per-frame
 * draw function. Pre-computed buffers and lookup tables belong inside
 * init's closure so the rAF loop allocates nothing.
 *
 * The hook handles DPR scaling, ResizeObserver-driven canvas resizing,
 * and rAF cleanup. Returns the canvas ref the caller should attach.
 */
export function useCanvasAnimator(init: () => CanvasDrawFn) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const initRef = useRef(init);
	initRef.current = init;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const resize = () => {
			const dpr = window.devicePixelRatio || 1;
			const { clientWidth, clientHeight } = canvas;
			canvas.width = Math.max(1, Math.floor(clientWidth * dpr));
			canvas.height = Math.max(1, Math.floor(clientHeight * dpr));
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(canvas);

		const draw = initRef.current();
		let rafId = 0;
		const tick = () => {
			rafId = requestAnimationFrame(tick);
			draw(ctx, canvas.clientWidth, canvas.clientHeight);
		};
		rafId = requestAnimationFrame(tick);

		return () => {
			ro.disconnect();
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, []);

	return canvasRef;
}

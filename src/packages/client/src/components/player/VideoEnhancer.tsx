import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
	videoEnhanceEnabled,
	videoEnhanceScale,
	videoEnhanceStrength,
} from '@/state/video-enhance.state';
import { sharedVideoEngine } from '@/state/videoEngineRef';
import { VideoEnhanceEngine } from '@/video/video-enhance.engine';
import styles from './VideoEnhancer.module.scss';

/**
 * GPU video-enhancement overlay. When enabled it mounts a WebGPU-backed
 * canvas inside the player's video wrapper, hides the underlying <video>
 * (it keeps playing — audio + HLS / seek / fullscreen all flow through
 * the same element), and pumps each frame through the enhance shader.
 *
 * The component is intentionally self-contained: state lives in
 * `video-enhance.state.ts`, the GPU work is owned by `VideoEnhanceEngine`,
 * and this file only handles DOM lifecycle + signal subscriptions.
 *
 * Renders null when disabled or when WebGPU isn't supported, so it's
 * safe to drop into the player tree unconditionally.
 */
export function VideoEnhancer() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const engineRef = useRef<VideoEnhanceEngine | null>(null);
	const videoEl = sharedVideoEngine.value?.videoRef.current ?? null;
	const enabled = videoEnhanceEnabled.value;
	const supported = VideoEnhanceEngine.isSupported();

	// Engine lifecycle: spin up when enabled & we have a video, tear down
	// otherwise. Strength + scale changes are wired separately so we
	// don't recreate the GPU device for a slider tweak.
	useEffect(() => {
		if (!enabled || !supported) return undefined;
		const canvas = canvasRef.current;
		const video = sharedVideoEngine.value?.videoRef.current ?? null;
		if (!canvas || !video) return undefined;

		// We do NOT hide the underlying <video>. The canvas (z-index:1,
		// opaque background) naturally overlays it once frames render, and
		// `opacity: 0` on the video has been observed to suppress
		// requestVideoFrameCallback on some Chromium builds — without rVFC
		// firing the canvas never resizes or draws.

		let cancelled = false;
		const engine = new VideoEnhanceEngine();
		engine.onError((err) => {
			// eslint-disable-next-line no-console -- intentional, user-visible failure path
			console.warn('[VideoEnhancer] disabled after GPU error:', err.message);
		});
		engine.setParams({
			strength: videoEnhanceStrength.value,
			scale: videoEnhanceScale.value,
		});

		engine.init(canvas, video).then((ok) => {
			if (cancelled) {
				engine.destroy();
				return;
			}
			if (!ok) return;
			engineRef.current = engine;
			engine.start();
		});

		// Push uniform changes to the live engine without recreating it.
		const dispose = effect(() => {
			const e = engineRef.current;
			if (!e) return;
			e.setParams({
				strength: videoEnhanceStrength.value,
				scale: videoEnhanceScale.value,
			});
		});

		return () => {
			cancelled = true;
			dispose();
			engineRef.current?.destroy();
			engineRef.current = null;
		};
		// We deliberately depend only on `enabled` and the resolved video
		// element. Strength/scale changes are handled by the inner effect.
	}, [enabled, supported, videoEl]);

	if (!enabled || !supported) return null;

	return <canvas ref={canvasRef} class={styles.canvas} aria-hidden="true" />;
}

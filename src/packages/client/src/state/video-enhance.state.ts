import { signal } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';

/**
 * GPU video-enhancement state. Lives apart from `video-effects.state.ts`
 * because the GPU pipeline (canvas overlay running a WebGPU shader) is a
 * completely different rendering path than the CSS `filter:` chain that
 * `video-effects` applies to the <video> element.
 *
 * The two can run independently; the canvas overlay simply hides the
 * underlying <video> visually when enabled (the <video> keeps playing so
 * audio + HLS / seek / fullscreen all keep working).
 */

const STRENGTH_KEY = 'video_enhance_strength';
const SCALE_KEY = 'video_enhance_scale';
const ENABLED_KEY = 'video_enhance_enabled';

/** WebGPU is the only path; if `navigator.gpu` is missing we hard-disable the UI. */
export const videoEnhanceSupported = signal(
	typeof navigator !== 'undefined' && 'gpu' in navigator,
);

/** Master toggle. */
export const videoEnhanceEnabled = signal<boolean>(getUiSetting(ENABLED_KEY, false));

/**
 * Unsharp-mask amount in 0..1. 0 = passthrough (just texture sample), 1 =
 * very aggressive (visible ringing on high-contrast edges).
 */
export const videoEnhanceStrength = signal<number>(getUiSetting(STRENGTH_KEY, 0.5));

/**
 * Output canvas backing-store size multiplier relative to the source
 * video's native pixel size. 1.0 = same resolution (sharpen only), 1.5 =
 * 1.5× upscale, 2.0 = 4× the pixel work. The shader uses the GPU
 * sampler's bilinear interpolation for the resampling step, with the
 * unsharp mask applied on top to recover edge definition.
 *
 * Higher scale costs more GPU time per frame (quadratic in pixels). On
 * an integrated GPU 1.5× is usually safe at 1080p source; 2.0× starts
 * to drop frames. The UI labels the slider as "Output Resolution".
 */
export const videoEnhanceScale = signal<number>(getUiSetting(SCALE_KEY, 1.5));

export function toggleVideoEnhance(): void {
	if (!videoEnhanceSupported.value) return;
	const next = !videoEnhanceEnabled.value;
	videoEnhanceEnabled.value = next;
	setUiSetting(ENABLED_KEY, next);
}

export function setVideoEnhanceStrength(v: number): void {
	if (!Number.isFinite(v)) return;
	const clamped = Math.max(0, Math.min(1, v));
	videoEnhanceStrength.value = clamped;
	setUiSetting(STRENGTH_KEY, clamped);
}

export function setVideoEnhanceScale(v: number): void {
	if (!Number.isFinite(v)) return;
	const clamped = Math.max(1, Math.min(2.5, v));
	videoEnhanceScale.value = clamped;
	setUiSetting(SCALE_KEY, clamped);
}

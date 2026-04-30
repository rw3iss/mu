import { signal } from '@preact/signals';
import { setUiSetting } from '@/hooks/useUiSetting';

/**
 * Video-effects state — colour grading, gamma, sharpening, geometric
 * transforms (vertical scale, crop). Lives apart from audio-effects
 * because it has nothing to do with audio at all; it's only here in
 * `state/` because the player UI shares the profile / collapsible /
 * tab plumbing with the audio effects panel.
 */

export interface VideoEffectSettings {
	brightness: number; // 0-200, default 100
	contrast: number; // 0-200, default 100
	saturation: number; // 0-200, default 100
	hueRotate: number; // 0-360, default 0
	sepia: number; // 0-100, default 0
	grayscale: number; // 0-100, default 0
	verticalScale: number; // 65-135, default 100 — fixes squished/stretched aspect
	gamma: number; // 50-200, default 100 — power-curve midtones (value/100 = gamma)
	blackLevel: number; // 0-30, default 0 — pulls black point up; crushes shadows
	crop: number; // 100-130, default 100 — uniform zoom past letterbox bars
	sharpen: number; // 0-100, default 0 — unsharp-mask amount (value/100 = kernel weight)
}

export const DEFAULT_VIDEO_EFFECTS: VideoEffectSettings = {
	brightness: 100,
	contrast: 100,
	saturation: 100,
	hueRotate: 0,
	sepia: 0,
	grayscale: 0,
	verticalScale: 100,
	gamma: 100,
	blackLevel: 0,
	crop: 100,
	sharpen: 0,
};

export const videoEnabled = signal(false);
export const videoEffects = signal<VideoEffectSettings>({ ...DEFAULT_VIDEO_EFFECTS });

export function toggleVideoEffects(): void {
	const next = !videoEnabled.value;
	videoEnabled.value = next;
	setUiSetting('video_effects_enabled', next);
}

export function updateVideoParam<K extends keyof VideoEffectSettings>(
	key: K,
	value: VideoEffectSettings[K],
): void {
	const settings = { ...videoEffects.value, [key]: value };
	videoEffects.value = settings;
	setUiSetting('video_effects_settings', settings);
}

export function resetVideoEffects(): void {
	const fresh = { ...DEFAULT_VIDEO_EFFECTS };
	videoEffects.value = fresh;
	setUiSetting('video_effects_settings', fresh);
}

import {
	type AudioQuality,
	availableQualities,
	DEFAULT_MUSIC_SETTINGS,
	type MusicSettings,
	qualitySpec,
} from '@mu/shared';
import { signal } from '@preact/signals';

/**
 * The server's music settings as last loaded (admin defaults, bitrates, FLAC
 * policy). Filled by `musicPrefs.state` and by the admin Music tab on save;
 * falls back to the shipped defaults until then.
 */
export const musicServerSettings = signal<MusicSettings | null>(null);

export const QUALITY_NAMES: Record<AudioQuality, string> = {
	original: 'Original',
	lossless: 'Lossless',
	high: 'High',
	normal: 'Normal',
	low: 'Low',
};

export interface QualityOption {
	value: AudioQuality;
	name: string;
	/** Concise format / bitrate / size under the current server config. */
	spec: string;
}

/** Qualities the server offers (no Lossless unless FLAC is allowed), with specs. */
export function qualityOptions(
	s: MusicSettings = musicServerSettings.value ?? DEFAULT_MUSIC_SETTINGS,
): QualityOption[] {
	return availableQualities(s).map((q) => ({
		value: q,
		name: QUALITY_NAMES[q],
		spec: qualitySpec(q, s),
	}));
}

/** One-line label, e.g. "High (AAC/Opus 192 kbps · ~1.4 MB/min)". */
export function qualityLabel(q: AudioQuality): string {
	const s = musicServerSettings.value ?? DEFAULT_MUSIC_SETTINGS;
	return `${QUALITY_NAMES[q]} (${qualitySpec(q, s)})`;
}

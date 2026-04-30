import { batch, signal } from '@preact/signals';
import { audioEngine, type CompressorSettings, type EqBand } from '@/audio/audio-engine';
import { setUiSetting } from '@/hooks/useUiSetting';
import { type AudioProfile, audioProfilesService } from '@/services/audio-profiles.service';
import {
	compressorEnabled,
	compressorSettings,
	eqBands,
	eqEnabled,
	eqInputGain,
} from './audio-effects.state';
import {
	DEFAULT_VIDEO_EFFECTS,
	type VideoEffectSettings,
	videoEffects,
	videoEnabled,
} from './video-effects.state';

/**
 * Profiles — per-effect saved presets users can name, load, update,
 * copy, and delete. Three types share this code path: 'eq',
 * 'compressor', 'video' (plus a legacy 'full' that applies eq + comp
 * together when loaded). Profiles live on the server (via
 * audioProfilesService); the signals below are the in-memory cache.
 *
 * This module reads from and writes back into the per-effect state
 * modules — `audio-effects.state` for EQ and compressor signals,
 * `video-effects.state` for video signals — so loading a profile
 * cleanly restores the relevant slice of effect state.
 */

export const profiles = signal<AudioProfile[]>([]);
export const activeEqProfileId = signal<string | null>(null);
export const activeCompProfileId = signal<string | null>(null);
export const activeVideoProfileId = signal<string | null>(null);
export const profilesLoading = signal(false);

/** @deprecated Use activeEqProfileId / activeCompProfileId instead */
export const activeProfileId = activeEqProfileId;

export async function fetchProfiles(): Promise<void> {
	profilesLoading.value = true;
	try {
		profiles.value = await audioProfilesService.getAll();
	} catch (err) {
		console.error('Failed to fetch audio profiles', err);
	} finally {
		profilesLoading.value = false;
	}
}

// ── EQ profile ──────────────────────────────────────────────────────

export function loadEqProfile(id: string): void {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;

	const config = JSON.parse(profile.config);
	const bands: EqBand[] = config.eqBands ? config.eqBands.map((b: EqBand) => ({ ...b })) : null;
	const loadedInputGain = config.inputGain ?? 0;

	if (bands) {
		audioEngine.setBands(bands);
		setUiSetting('audio_eq_bands', bands);
	}
	if (config.eqEnabled !== undefined) {
		audioEngine.setEqEnabled(config.eqEnabled);
		setUiSetting('audio_eq_enabled', config.eqEnabled);
	}
	audioEngine.setInputGain(loadedInputGain);
	setUiSetting('audio_eq_input_gain', loadedInputGain);

	batch(() => {
		activeEqProfileId.value = id;
		eqInputGain.value = loadedInputGain;
		if (bands) eqBands.value = bands;
		if (config.eqEnabled !== undefined) eqEnabled.value = config.eqEnabled;
	});
	setUiSetting('active_eq_profile_id', id);
}

// ── Compressor profile ──────────────────────────────────────────────

export function loadCompProfile(id: string): void {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;

	const config = JSON.parse(profile.config);
	const compSettings: CompressorSettings | null = config.compressorSettings
		? { ...config.compressorSettings }
		: null;

	if (compSettings) {
		audioEngine.setCompressorSettings(compSettings);
		setUiSetting('audio_compressor_settings', compSettings);
	}
	if (config.compressorEnabled !== undefined) {
		audioEngine.setCompressorEnabled(config.compressorEnabled);
		setUiSetting('audio_compressor_enabled', config.compressorEnabled);
	}

	batch(() => {
		activeCompProfileId.value = id;
		if (compSettings) compressorSettings.value = compSettings;
		if (config.compressorEnabled !== undefined)
			compressorEnabled.value = config.compressorEnabled;
	});
	setUiSetting('active_comp_profile_id', id);
}

/** Legacy: load a profile applying both EQ and compressor settings. */
export function loadProfile(id: string): void {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;

	if (profile.type === 'eq') {
		loadEqProfile(id);
	} else if (profile.type === 'compressor') {
		loadCompProfile(id);
	} else {
		// Full profile — load both
		loadEqProfile(id);
		loadCompProfile(id);
	}
}

// ── Profile config builders ─────────────────────────────────────────

function buildEqConfigJson(): string {
	return JSON.stringify({
		inputGain: eqInputGain.value,
		eqEnabled: eqEnabled.value,
		eqBands: eqBands.value,
	});
}

function buildCompConfigJson(): string {
	return JSON.stringify({
		compressorEnabled: compressorEnabled.value,
		compressorSettings: compressorSettings.value,
	});
}

function buildVideoConfigJson(): string {
	return JSON.stringify({
		videoEnabled: videoEnabled.value,
		videoEffects: videoEffects.value,
	});
}

function generateUntitledName(type: string): string {
	const existing = profiles.value.filter((p) => p.type === type);
	let n = 1;
	while (existing.some((p) => p.name === `Untitled ${n}`)) {
		n++;
	}
	return `Untitled ${n}`;
}

// ── EQ profile CRUD ─────────────────────────────────────────────────

export async function saveEqProfile(name: string): Promise<AudioProfile> {
	const resolvedName = name.trim() || generateUntitledName('eq');
	const profile = await audioProfilesService.create({
		name: resolvedName,
		type: 'eq',
		config: buildEqConfigJson(),
	});
	profiles.value = [...profiles.value, profile];
	activeEqProfileId.value = profile.id;
	return profile;
}

export async function updateEqProfile(id: string, newName?: string): Promise<void> {
	const updateData: { config: string; name?: string } = { config: buildEqConfigJson() };
	if (newName !== undefined) updateData.name = newName;
	const updated = await audioProfilesService.update(id, updateData);
	profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
}

// ── Compressor profile CRUD ─────────────────────────────────────────

export async function saveCompProfile(name: string): Promise<AudioProfile> {
	const resolvedName = name.trim() || generateUntitledName('compressor');
	const profile = await audioProfilesService.create({
		name: resolvedName,
		type: 'compressor',
		config: buildCompConfigJson(),
	});
	profiles.value = [...profiles.value, profile];
	activeCompProfileId.value = profile.id;
	return profile;
}

export async function updateCompProfile(id: string, newName?: string): Promise<void> {
	const updateData: { config: string; name?: string } = { config: buildCompConfigJson() };
	if (newName !== undefined) updateData.name = newName;
	const updated = await audioProfilesService.update(id, updateData);
	profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
}

// ── Video profile CRUD ──────────────────────────────────────────────

export function loadVideoProfile(id: string): void {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;

	const config = JSON.parse(profile.config);
	const effects: VideoEffectSettings | null = config.videoEffects
		? { ...DEFAULT_VIDEO_EFFECTS, ...config.videoEffects }
		: null;

	if (effects) {
		videoEffects.value = effects;
		setUiSetting('video_effects_settings', effects);
	}
	if (config.videoEnabled !== undefined) {
		videoEnabled.value = config.videoEnabled;
		setUiSetting('video_effects_enabled', config.videoEnabled);
	}

	activeVideoProfileId.value = id;
	setUiSetting('active_video_profile_id', id);
}

export async function saveVideoProfile(name: string): Promise<AudioProfile> {
	const resolvedName = name.trim() || generateUntitledName('video');
	const profile = await audioProfilesService.create({
		name: resolvedName,
		type: 'video',
		config: buildVideoConfigJson(),
	});
	profiles.value = [...profiles.value, profile];
	activeVideoProfileId.value = profile.id;
	return profile;
}

export async function updateVideoProfile(id: string, newName?: string): Promise<void> {
	const updateData: { config: string; name?: string } = { config: buildVideoConfigJson() };
	if (newName !== undefined) updateData.name = newName;
	const updated = await audioProfilesService.update(id, updateData);
	profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
}

// ── Cross-cutting ───────────────────────────────────────────────────

/** @deprecated Use saveEqProfile / saveCompProfile instead */
export async function saveProfile(name: string): Promise<AudioProfile> {
	return saveEqProfile(name);
}

/** @deprecated Use updateEqProfile / updateCompProfile instead */
export async function updateProfile(id: string, newName?: string): Promise<void> {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;
	if (profile.type === 'compressor') {
		return updateCompProfile(id, newName);
	}
	return updateEqProfile(id, newName);
}

export async function copyProfile(id: string): Promise<void> {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;

	const copy = await audioProfilesService.create({
		name: `${profile.name} (Copy)`,
		type: profile.type,
		config: profile.config,
	});

	profiles.value = [...profiles.value, copy];
	if (copy.type === 'video') {
		activeVideoProfileId.value = copy.id;
	} else if (copy.type === 'compressor') {
		activeCompProfileId.value = copy.id;
	} else {
		activeEqProfileId.value = copy.id;
	}
}

export async function deleteProfile(id: string): Promise<void> {
	await audioProfilesService.remove(id);
	profiles.value = profiles.value.filter((p) => p.id !== id);
	if (activeEqProfileId.value === id) {
		activeEqProfileId.value = null;
		setUiSetting('active_eq_profile_id', null);
	}
	if (activeCompProfileId.value === id) {
		activeCompProfileId.value = null;
		setUiSetting('active_comp_profile_id', null);
	}
	if (activeVideoProfileId.value === id) {
		activeVideoProfileId.value = null;
		setUiSetting('active_video_profile_id', null);
	}
}

import { batch, signal } from '@preact/signals';
import {
	audioEngine,
	type CompressorSettings,
	DEFAULT_COMPRESSOR,
	DEFAULT_EQ_BANDS,
	type EqBand,
} from '@/audio/audio-engine';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { type AudioProfile, audioProfilesService } from '@/services/audio-profiles.service';

// ============================================
// Signals
// ============================================

export const showEffectsPanel = signal(false);
export const effectsTab = signal<'eq' | 'compressor' | 'video'>('eq');

export const eqEnabled = signal(false);
export const eqInputGain = signal(0);
export const eqBands = signal<EqBand[]>(DEFAULT_EQ_BANDS.map((b) => ({ ...b })));

export const compressorEnabled = signal(false);
export const compressorSettings = signal<CompressorSettings>({ ...DEFAULT_COMPRESSOR });

// Video effects
export interface VideoEffectSettings {
	brightness: number; // 0-200, default 100
	contrast: number; // 0-200, default 100
	saturation: number; // 0-200, default 100
	hueRotate: number; // 0-360, default 0
	sepia: number; // 0-100, default 0
	grayscale: number; // 0-100, default 0
}

export const DEFAULT_VIDEO_EFFECTS: VideoEffectSettings = {
	brightness: 100,
	contrast: 100,
	saturation: 100,
	hueRotate: 0,
	sepia: 0,
	grayscale: 0,
};

export const videoEnabled = signal(false);
export const videoEffects = signal<VideoEffectSettings>({ ...DEFAULT_VIDEO_EFFECTS });

export const profiles = signal<AudioProfile[]>([]);
export const activeEqProfileId = signal<string | null>(null);
export const activeCompProfileId = signal<string | null>(null);
export const activeVideoProfileId = signal<string | null>(null);
export const profilesLoading = signal(false);

/** @deprecated Use activeEqProfileId / activeCompProfileId instead */
export const activeProfileId = activeEqProfileId;

// ============================================
// Initialization
// ============================================

export function initAudioEffects(): void {
	const savedEq = getUiSetting('audio_eq_enabled', false);
	const savedComp = getUiSetting('audio_compressor_enabled', false);
	const savedBands = getUiSetting<EqBand[] | null>('audio_eq_bands', null);
	const savedCompSettings = getUiSetting<CompressorSettings | null>(
		'audio_compressor_settings',
		null,
	);

	const savedInputGain = getUiSetting('audio_eq_input_gain', 0);

	// Apply to engine first
	if (savedBands) audioEngine.setBands(savedBands);
	if (savedCompSettings) audioEngine.setCompressorSettings(savedCompSettings);
	audioEngine.setEqEnabled(savedEq);
	audioEngine.setCompressorEnabled(savedComp);
	audioEngine.setInputGain(savedInputGain);

	const savedVideoEnabled = getUiSetting('video_effects_enabled', false);
	const savedVideoEffects = getUiSetting<VideoEffectSettings | null>(
		'video_effects_settings',
		null,
	);

	// Restore active profile IDs
	const savedEqProfileId = getUiSetting<string | null>('active_eq_profile_id', null);
	const savedCompProfileId = getUiSetting<string | null>('active_comp_profile_id', null);
	const savedVideoProfileId = getUiSetting<string | null>('active_video_profile_id', null);

	// Batch signal updates
	batch(() => {
		eqEnabled.value = savedEq;
		eqInputGain.value = savedInputGain;
		compressorEnabled.value = savedComp;
		if (savedBands) eqBands.value = savedBands;
		if (savedCompSettings) compressorSettings.value = savedCompSettings;
		videoEnabled.value = savedVideoEnabled;
		if (savedVideoEffects) videoEffects.value = savedVideoEffects;
		activeEqProfileId.value = savedEqProfileId;
		activeCompProfileId.value = savedCompProfileId;
		activeVideoProfileId.value = savedVideoProfileId;
	});
}

// ============================================
// Actions
// ============================================

export function toggleEffectsPanel(): void {
	showEffectsPanel.value = !showEffectsPanel.value;
}

export function closeEffectsPanel(): void {
	showEffectsPanel.value = false;
}

export function setEffectsTab(tab: 'eq' | 'compressor' | 'video'): void {
	effectsTab.value = tab;
}

export function toggleEq(): void {
	const next = !eqEnabled.value;
	eqEnabled.value = next;
	audioEngine.setEqEnabled(next);
	setUiSetting('audio_eq_enabled', next);
}

export function toggleCompressor(): void {
	const next = !compressorEnabled.value;
	compressorEnabled.value = next;
	audioEngine.setCompressorEnabled(next);
	setUiSetting('audio_compressor_enabled', next);
}

export function updateInputGain(db: number): void {
	eqInputGain.value = db;
	audioEngine.setInputGain(db);
	setUiSetting('audio_eq_input_gain', db);
}

export function updateEqBand(index: number, gain: number): void {
	audioEngine.updateBand(index, gain);
	const bands = audioEngine.getBands();
	eqBands.value = bands;
	setUiSetting('audio_eq_bands', bands);
}

export function updateEqBandQ(index: number, q: number): void {
	audioEngine.updateBandQ(index, q);
	const bands = audioEngine.getBands();
	eqBands.value = bands;
	setUiSetting('audio_eq_bands', bands);
}

export function resetEq(): void {
	const freshBands = DEFAULT_EQ_BANDS.map((b) => ({ ...b }));
	audioEngine.setBands(freshBands);
	audioEngine.setInputGain(0);
	eqBands.value = freshBands;
	eqInputGain.value = 0;
	setUiSetting('audio_eq_bands', freshBands);
	setUiSetting('audio_eq_input_gain', 0);
}

export function updateCompressorParam<K extends keyof CompressorSettings>(
	key: K,
	value: CompressorSettings[K],
): void {
	const settings = { ...compressorSettings.value, [key]: value };
	compressorSettings.value = settings;
	audioEngine.setCompressorSettings(settings);
	setUiSetting('audio_compressor_settings', settings);
}

export function resetCompressor(): void {
	const freshSettings = { ...DEFAULT_COMPRESSOR };
	audioEngine.setCompressorSettings(freshSettings);
	compressorSettings.value = freshSettings;
	setUiSetting('audio_compressor_settings', freshSettings);
}

// ============================================
// Video Effects
// ============================================

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

// ============================================
// Profile Management
// ============================================

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

/**
 * Load an EQ profile — only applies EQ-related settings.
 */
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

/**
 * Load a compressor profile — only applies compressor-related settings.
 */
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

/**
 * Legacy: load a profile applying both EQ and compressor settings.
 */
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

function generateUntitledName(type: string): string {
	const existing = profiles.value.filter((p) => p.type === type);
	let n = 1;
	while (existing.some((p) => p.name === `Untitled ${n}`)) {
		n++;
	}
	return `Untitled ${n}`;
}

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

export async function updateEqProfile(id: string, newName?: string): Promise<void> {
	const updateData: { config: string; name?: string } = { config: buildEqConfigJson() };
	if (newName !== undefined) updateData.name = newName;
	const updated = await audioProfilesService.update(id, updateData);
	profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
}

export async function updateCompProfile(id: string, newName?: string): Promise<void> {
	const updateData: { config: string; name?: string } = { config: buildCompConfigJson() };
	if (newName !== undefined) updateData.name = newName;
	const updated = await audioProfilesService.update(id, updateData);
	profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
}

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

// ============================================
// Video Profile Management
// ============================================

function buildVideoConfigJson(): string {
	return JSON.stringify({
		videoEnabled: videoEnabled.value,
		videoEffects: videoEffects.value,
	});
}

export function loadVideoProfile(id: string): void {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;

	const config = JSON.parse(profile.config);
	const effects: VideoEffectSettings | null = config.videoEffects
		? { ...config.videoEffects }
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

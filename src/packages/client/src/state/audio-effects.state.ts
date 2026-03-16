import { batch, signal } from '@preact/signals';
import {
	type CompressorSettings,
	DEFAULT_COMPRESSOR,
	DEFAULT_EQ_BANDS,
	type EqBand,
	audioEngine,
} from '@/audio/audio-engine';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { type AudioProfile, audioProfilesService } from '@/services/audio-profiles.service';

// ============================================
// Signals
// ============================================

export const showEffectsPanel = signal(false);
export const effectsTab = signal<'eq' | 'compressor'>('eq');

export const eqEnabled = signal(false);
export const eqBands = signal<EqBand[]>(DEFAULT_EQ_BANDS.map((b) => ({ ...b })));

export const compressorEnabled = signal(false);
export const compressorSettings = signal<CompressorSettings>({ ...DEFAULT_COMPRESSOR });

export const profiles = signal<AudioProfile[]>([]);
export const activeProfileId = signal<string | null>(null);
export const profilesLoading = signal(false);

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

	// Apply to engine first
	if (savedBands) audioEngine.setBands(savedBands);
	if (savedCompSettings) audioEngine.setCompressorSettings(savedCompSettings);
	audioEngine.setEqEnabled(savedEq);
	audioEngine.setCompressorEnabled(savedComp);

	// Batch signal updates
	batch(() => {
		eqEnabled.value = savedEq;
		compressorEnabled.value = savedComp;
		if (savedBands) eqBands.value = savedBands;
		if (savedCompSettings) compressorSettings.value = savedCompSettings;
	});
}

// ============================================
// Actions
// ============================================

export function toggleEffectsPanel(): void {
	showEffectsPanel.value = !showEffectsPanel.value;
}

export function setEffectsTab(tab: 'eq' | 'compressor'): void {
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
	eqBands.value = freshBands;
	setUiSetting('audio_eq_bands', freshBands);
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

export function loadProfile(id: string): void {
	const profile = profiles.value.find((p) => p.id === id);
	if (!profile) return;

	const config = JSON.parse(profile.config);

	// Deep-clone bands to ensure fresh object references
	const bands: EqBand[] = config.eqBands ? config.eqBands.map((b: EqBand) => ({ ...b })) : null;
	const compSettings: CompressorSettings | null = config.compressorSettings
		? { ...config.compressorSettings }
		: null;

	// Apply to audio engine first (synchronous, outside batch)
	if (bands) {
		audioEngine.setBands(bands);
		setUiSetting('audio_eq_bands', bands);
	}
	if (compSettings) {
		audioEngine.setCompressorSettings(compSettings);
		setUiSetting('audio_compressor_settings', compSettings);
	}
	if (config.eqEnabled !== undefined) {
		audioEngine.setEqEnabled(config.eqEnabled);
		setUiSetting('audio_eq_enabled', config.eqEnabled);
	}
	if (config.compressorEnabled !== undefined) {
		audioEngine.setCompressorEnabled(config.compressorEnabled);
		setUiSetting('audio_compressor_enabled', config.compressorEnabled);
	}

	// Batch all signal updates so components re-render once with consistent state
	batch(() => {
		activeProfileId.value = id;
		if (bands) eqBands.value = bands;
		if (compSettings) compressorSettings.value = compSettings;
		if (config.eqEnabled !== undefined) eqEnabled.value = config.eqEnabled;
		if (config.compressorEnabled !== undefined)
			compressorEnabled.value = config.compressorEnabled;
	});
}

export async function saveProfile(name: string): Promise<AudioProfile> {
	const config = JSON.stringify({
		eqEnabled: eqEnabled.value,
		eqBands: eqBands.value,
		compressorEnabled: compressorEnabled.value,
		compressorSettings: compressorSettings.value,
	});

	const profile = await audioProfilesService.create({
		name,
		type: 'full',
		config,
	});

	profiles.value = [...profiles.value, profile];
	activeProfileId.value = profile.id;
	return profile;
}

export async function updateProfile(id: string): Promise<void> {
	const config = JSON.stringify({
		eqEnabled: eqEnabled.value,
		eqBands: eqBands.value,
		compressorEnabled: compressorEnabled.value,
		compressorSettings: compressorSettings.value,
	});

	const updated = await audioProfilesService.update(id, { config });
	profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
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
	activeProfileId.value = copy.id;
}

export async function deleteProfile(id: string): Promise<void> {
	await audioProfilesService.remove(id);
	profiles.value = profiles.value.filter((p) => p.id !== id);
	if (activeProfileId.value === id) {
		activeProfileId.value = null;
	}
}

export async function renameProfile(id: string, name: string): Promise<void> {
	const updated = await audioProfilesService.update(id, { name });
	profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
}

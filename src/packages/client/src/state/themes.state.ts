import type { ThemeConfig, ThemeRecord } from '@mu/shared';
import { effect, signal } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { themesApi } from '@/services/themes.service';
import { theme } from './theme.state';

// ============================================
// Signals
// ============================================

export const themesList = signal<ThemeRecord[]>([]);
export const selectedDarkId = signal<string>(getUiSetting<string>('selected_dark_theme', ''));
export const selectedLightId = signal<string>(getUiSetting<string>('selected_light_theme', ''));
export const activeConfig = signal<ThemeConfig | null>(null);
export const editingThemeId = signal<string>('');

// ============================================
// Helpers
// ============================================

const ITEM_GAP_MAP: Record<string, string> = {
	none: '0px',
	minimal: '4px',
	compact: '8px',
	normal: '16px',
	comfortable: '24px',
	spaced: '48px',
};

function hexToRgbParts(hex: string): { r: number; g: number; b: number } {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!m) return { r: 120, g: 140, b: 180 };
	return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// ============================================
// Actions
// ============================================

export function getResolvedMode(): 'dark' | 'light' {
	const t = theme.value;
	if (t === 'auto') {
		if (typeof window === 'undefined') return 'dark';
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}
	return t;
}

export function applyThemeConfig(config: ThemeConfig): void {
	const root = document.documentElement;

	root.style.setProperty('--color-accent', config.accentColor);
	root.style.setProperty('--color-bg-primary', config.pageBg);
	root.style.setProperty('--color-bg-surface', config.panelBg);
	root.style.setProperty('--panel-bg', config.panelBg);
	root.style.setProperty('--item-gap', ITEM_GAP_MAP[config.itemSpacing] ?? ITEM_GAP_MAP.normal);
	root.style.setProperty('--item-radius', `${config.itemRadius}px`);

	const { r, g, b } = hexToRgbParts(config.cardBorder.color);
	root.style.setProperty(
		'--card-border',
		`${config.cardBorder.width}px solid rgba(${r}, ${g}, ${b}, ${config.cardBorder.opacity})`,
	);

	if (config.disableHover) {
		root.dataset.nohover = '';
	} else {
		delete root.dataset.nohover;
	}

	root.style.setProperty('--text-scale', String(config.textScale));

	activeConfig.value = config;
}

export function applyActiveTheme(): void {
	const mode = getResolvedMode();
	const list = themesList.value;
	const targetId = mode === 'dark' ? selectedDarkId.value : selectedLightId.value;

	let found: ThemeRecord | undefined;
	if (targetId) {
		found = list.find((t) => t.id === targetId);
	}
	if (!found) {
		found = list.find((t) => t.mode === mode && t.isDefault);
	}
	if (!found) {
		found = list.find((t) => t.mode === mode);
	}

	if (found) {
		applyThemeConfig(found.config);
	}
}

export function setSelectedDarkId(id: string): void {
	selectedDarkId.value = id;
	setUiSetting('selected_dark_theme', id);
	applyActiveTheme();
}

export function setSelectedLightId(id: string): void {
	selectedLightId.value = id;
	setUiSetting('selected_light_theme', id);
	applyActiveTheme();
}

export async function fetchThemes(): Promise<void> {
	try {
		const list = await themesApi.list();
		themesList.value = list;

		// Auto-select defaults if none selected
		if (!selectedDarkId.value) {
			const darkDefault = list.find((t) => t.mode === 'dark' && t.isDefault);
			if (darkDefault) {
				selectedDarkId.value = darkDefault.id;
				setUiSetting('selected_dark_theme', darkDefault.id);
			}
		}
		if (!selectedLightId.value) {
			const lightDefault = list.find((t) => t.mode === 'light' && t.isDefault);
			if (lightDefault) {
				selectedLightId.value = lightDefault.id;
				setUiSetting('selected_light_theme', lightDefault.id);
			}
		}

		applyActiveTheme();
	} catch {
		// Theme API may not be available yet — ignore
	}
}

// ============================================
// Effect — re-apply when dark/light/auto changes
// ============================================

effect(() => {
	// Subscribe to theme signal changes
	const _mode = theme.value;
	if (themesList.value.length > 0) {
		applyActiveTheme();
	}
});

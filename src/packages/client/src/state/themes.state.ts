import type { ThemeConfig, ThemeRecord } from '@mu/shared';
import { effect, signal } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { themesApi } from '@/services/themes.service';
import { baseFontScale } from './appearance.state';
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

/**
 * Briefly flip a `data-theme-transitioning` attribute on <html> so the
 * global crossfade rule in global.scss activates for one swap window.
 * Without this, switching themes snaps every color instantly across
 * the entire UI. The window covers one full --theme-transition-duration.
 */
function flashThemeTransition(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	// Read the computed duration so we don't drop the flag mid-fade.
	const durStr = getComputedStyle(root).getPropertyValue('--theme-transition-duration').trim();
	const durMs = parseFloat(durStr) || 220;
	root.setAttribute('data-theme-transitioning', 'true');
	window.setTimeout(() => {
		root.removeAttribute('data-theme-transitioning');
	}, durMs + 30); // small buffer for the end of the easing curve
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

// Tracks rich `tokens` keys we applied last time, so the next apply can
// clear any token the new theme doesn't override (prevents the previous
// theme's palette from leaking through on switch).
let previousTokenKeys: string[] = [];

export function applyThemeConfig(config: ThemeConfig): void {
	const root = document.documentElement;

	// Activate the one-window CSS crossfade so root colors glide into
	// the new palette instead of snapping. No-op on the very first
	// apply (no FOUC) because the root has no prior color to fade from.
	if (activeConfig.value !== null) {
		flashThemeTransition();
	}

	// Clear any rich tokens from the previous theme that the new theme
	// doesn't set — otherwise switching from a richly-themed entry back
	// to a minimal one would leave stale CSS variables behind.
	const nextTokenKeys = config.tokens ? Object.keys(config.tokens) : [];
	for (const key of previousTokenKeys) {
		if (!nextTokenKeys.includes(key)) {
			root.style.removeProperty(`--${key}`);
		}
	}
	previousTokenKeys = nextTokenKeys;

	// Apply rich tokens FIRST so the narrow base fields below win for
	// the few keys they overlap with (accent / bg / panel) — those
	// always reflect the user-editable color pickers, even if the
	// theme also lists them in `tokens`.
	if (config.tokens) {
		for (const [key, value] of Object.entries(config.tokens)) {
			if (value) root.style.setProperty(`--${key}`, value);
		}
	}

	root.style.setProperty('--color-accent', config.accentColor);
	root.style.setProperty('--color-bg-primary', config.pageBg);
	root.style.setProperty('--color-bg-surface', config.panelBg);
	root.style.setProperty('--panel-bg', config.panelBg);
	root.style.setProperty('--item-gap', ITEM_GAP_MAP[config.itemSpacing] ?? ITEM_GAP_MAP.normal);
	root.style.setProperty('--item-radius', `${config.itemRadius}px`);

	// Derive `--accent-rgb` (space-separated) from the accent hex so
	// callers can build translucent variants via `rgb(var(--accent-rgb)
	// / 0.4)`. Theme.tokens may override this explicitly (Aurora /
	// Sunset Cinema / Vaporwave do); the derivation here is the
	// fallback that keeps every theme — including user-picked accent
	// colors via the ColorPicker — coherent.
	const accentRgbToken = config.tokens?.['accent-rgb'];
	if (!accentRgbToken) {
		const { r, g, b } = hexToRgbParts(config.accentColor);
		root.style.setProperty('--accent-rgb', `${r} ${g} ${b}`);
	}

	const { r, g, b } = hexToRgbParts(config.cardBorder.color);
	root.style.setProperty(
		'--card-border',
		`${config.cardBorder.width}px solid rgba(${r}, ${g}, ${b}, ${config.cardBorder.opacity})`,
	);

	// Note: `disableHover` is intentionally NOT applied here anymore — it's
	// owned by the global appearance state (`appearance.state.ts`), which
	// sets the canonical `data-no-hover` attribute. Legacy per-theme
	// `config.disableHover` values are ignored.

	// `--text-scale` is computed reactively as baseFontScale * theme.textScale
	// by the effect at the bottom of this file. We don't write it here so
	// that swapping themes won't clobber an in-flight base-scale change.

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

// ============================================
// Effect — compute effective font scale
// effective = baseFontScale (global) * theme.textScale (multiplier)
// ============================================

effect(() => {
	const base = baseFontScale.value;
	const themeMul = activeConfig.value?.textScale ?? 1.0;
	const effective = base * themeMul;
	document.documentElement.style.setProperty('--text-scale', String(effective));
});

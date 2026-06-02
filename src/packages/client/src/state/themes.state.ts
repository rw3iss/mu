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

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	let h = 0;
	let s = 0;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case rn:
				h = (gn - bn) / d + (gn < bn ? 6 : 0);
				break;
			case gn:
				h = (bn - rn) / d + 2;
				break;
			default:
				h = (rn - gn) / d + 4;
		}
		h /= 6;
	}
	return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
	const m = l - c / 2;
	let rp = 0;
	let gp = 0;
	let bp = 0;
	const seg = h * 6;
	if (seg < 1) {
		rp = c;
		gp = x;
	} else if (seg < 2) {
		rp = x;
		gp = c;
	} else if (seg < 3) {
		gp = c;
		bp = x;
	} else if (seg < 4) {
		gp = x;
		bp = c;
	} else if (seg < 5) {
		rp = x;
		bp = c;
	} else {
		rp = c;
		bp = x;
	}
	const toHex = (v: number) =>
		Math.round((v + m) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${toHex(rp)}${toHex(gp)}${toHex(bp)}`;
}

/**
 * Derive a harmonious palette of accent variants from a single hex.
 * Returns hover (lighter, more saturated), active (darker), and a
 * subtle translucent fill. Lets any user-picked accent automatically
 * get a coherent set of variants without the theme having to specify
 * each one. Themes that DO provide explicit values in `tokens` still
 * win — this is the fallback, not the override.
 *
 * The shifts are chosen empirically to match the existing curated
 * themes (Midnight Reel: hover +12% L, active -8% L; subtle 0.14
 * alpha). They work across hues because the ramp is in HSL.
 */
function deriveAccentVariants(hex: string): {
	hover: string;
	active: string;
	subtle: string;
	rgb: string;
} {
	const { r, g, b } = hexToRgbParts(hex);
	const { h, s, l } = rgbToHsl(r, g, b);
	// Hover sits brighter; active sits darker. Saturation bumped slightly on
	// hover so it pops; trimmed on active so it doesn't muddy.
	const hoverL = Math.min(0.92, l + 0.1);
	const hoverS = Math.min(1, s + 0.05);
	const activeL = Math.max(0.18, l - 0.1);
	const activeS = Math.max(0, s - 0.05);
	return {
		hover: hslToHex(h, hoverS, hoverL),
		active: hslToHex(h, activeS, activeL),
		subtle: `rgba(${r}, ${g}, ${b}, 0.14)`,
		rgb: `${r} ${g} ${b}`,
	};
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

	// Hover-highlight background. When a theme defines it (config.hoverBg) it
	// wins; otherwise clear the inline value so it falls back to the theme's
	// `tokens` (if any) or the SCSS default — important so switching FROM a
	// theme that set it TO one that didn't doesn't leak the old colour.
	if (config.hoverBg) {
		root.style.setProperty('--color-bg-hover', config.hoverBg);
	} else if (!config.tokens?.['color-bg-hover']) {
		root.style.removeProperty('--color-bg-hover');
	}

	// Derive a coherent palette from `accentColor` for any variant the
	// theme didn't supply explicitly. Theme `tokens` values still win
	// when present — this is the fallback that keeps user-picked
	// accents (via ColorPicker) harmonious without forcing the user
	// to also pick hover/active/subtle.
	const variants = deriveAccentVariants(config.accentColor);
	if (!config.tokens?.['accent-rgb']) {
		root.style.setProperty('--accent-rgb', variants.rgb);
	}
	if (!config.tokens?.['color-accent-hover']) {
		root.style.setProperty('--color-accent-hover', variants.hover);
	}
	if (!config.tokens?.['color-accent-active']) {
		root.style.setProperty('--color-accent-active', variants.active);
	}
	if (!config.tokens?.['color-accent-subtle']) {
		root.style.setProperty('--color-accent-subtle', variants.subtle);
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

import { signal, effect } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';

// ============================================
// Helpers
// ============================================

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!m) return null;
	return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function clamp(v: number): number {
	return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

function lighten(hex: string, amount: number): string {
	const rgb = hexToRgb(hex);
	if (!rgb) return hex;
	return rgbToHex(
		rgb.r + (255 - rgb.r) * amount,
		rgb.g + (255 - rgb.g) * amount,
		rgb.b + (255 - rgb.b) * amount,
	);
}

function darken(hex: string, amount: number): string {
	const rgb = hexToRgb(hex);
	if (!rgb) return hex;
	return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
}

// ============================================
// Signal
// ============================================

const saved = getUiSetting<string>('accent_color', '');
export const accentColor = signal<string>(saved);

// ============================================
// Effect — apply/remove CSS overrides
// ============================================

effect(() => {
	const color = accentColor.value;
	const root = document.documentElement;

	if (!color) {
		// Remove overrides — fall back to CSS defaults
		root.style.removeProperty('--color-accent');
		root.style.removeProperty('--color-accent-hover');
		root.style.removeProperty('--color-accent-active');
		root.style.removeProperty('--color-accent-subtle');
		root.style.removeProperty('--shadow-glow');
		return;
	}

	const rgb = hexToRgb(color);
	if (!rgb) return;

	root.style.setProperty('--color-accent', color);
	root.style.setProperty('--color-accent-hover', lighten(color, 0.15));
	root.style.setProperty('--color-accent-active', darken(color, 0.15));
	root.style.setProperty('--color-accent-subtle', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
	root.style.setProperty('--shadow-glow', `0 0 24px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
});

// ============================================
// Actions
// ============================================

export function setAccentColor(hex: string): void {
	accentColor.value = hex;
	setUiSetting('accent_color', hex);
}

export function resetAccentColor(): void {
	accentColor.value = '';
	setUiSetting('accent_color', '');
}

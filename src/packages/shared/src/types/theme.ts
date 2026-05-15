/**
 * Optional palette of raw CSS custom-property overrides.
 *
 * Keys are the un-prefixed token name (e.g. `color-bg-primary`,
 * `surface-overlay-1`, `shadow-glow`). Values are any valid CSS value.
 * When present, these are written verbatim to `:root` after the base
 * SCSS defaults, letting curated themes paint every surface — not just
 * accent + page bg + panel bg.
 *
 * Existing user-saved themes (which only have the base config below)
 * stay 100% compatible: any token not listed here falls back to the
 * SCSS default in `_variables.scss`.
 */
export type ThemeTokens = Partial<Record<string, string>>;

export interface ThemeConfig {
	accentColor: string;
	pageBg: string;
	panelBg: string;
	itemSpacing: string;
	itemRadius: number;
	cardBorder: { width: number; color: string; opacity: number };
	disableHover: boolean;
	textScale: number;
	/** Optional rich-palette override. See {@link ThemeTokens}. */
	tokens?: ThemeTokens;
}

export interface ThemeRecord {
	id: string;
	name: string;
	mode: 'dark' | 'light';
	config: ThemeConfig;
	isDefault: boolean;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

export const DEFAULT_DARK_CONFIG: ThemeConfig = {
	accentColor: '#06b6d4',
	pageBg: '#050709',
	panelBg: '#090b12',
	itemSpacing: 'normal',
	itemRadius: 3,
	cardBorder: { width: 1, color: '#788cb4', opacity: 0.07 },
	disableHover: false,
	textScale: 1.0,
};

export const DEFAULT_LIGHT_CONFIG: ThemeConfig = {
	accentColor: '#0891b2',
	pageBg: '#f8fafc',
	panelBg: '#ffffff',
	itemSpacing: 'normal',
	itemRadius: 3,
	cardBorder: { width: 1, color: '#94a3b8', opacity: 0.15 },
	disableHover: false,
	textScale: 1.0,
};

export function validateThemeConfig(obj: unknown): obj is ThemeConfig {
	if (!obj || typeof obj !== 'object') return false;
	const c = obj as Record<string, unknown>;
	return (
		typeof c.accentColor === 'string' &&
		typeof c.pageBg === 'string' &&
		typeof c.panelBg === 'string' &&
		typeof c.itemSpacing === 'string' &&
		typeof c.itemRadius === 'number' &&
		typeof c.cardBorder === 'object' &&
		typeof c.disableHover === 'boolean' &&
		typeof c.textScale === 'number'
	);
}

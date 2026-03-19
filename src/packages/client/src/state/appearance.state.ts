import { effect, signal } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';

// ============================================
// Types
// ============================================

export interface CardBorder {
	width: number;
	color: string;
	opacity: number;
}

export type ItemSpacing = 'none' | 'minimal' | 'compact' | 'normal' | 'comfortable' | 'spaced';

/** Available font scale levels */
export const TEXT_SCALE_VALUES = [0.5, 0.75, 1.0, 1.25, 1.5] as const;
export type TextScale = (typeof TEXT_SCALE_VALUES)[number];

// ============================================
// Defaults
// ============================================

const DEFAULT_ITEM_SPACING: ItemSpacing = 'normal';
const DEFAULT_ITEM_RADIUS = 3;
const DEFAULT_CARD_BORDER: CardBorder = { width: 1, color: '#788cb4', opacity: 0.07 };
const DEFAULT_PAGE_BG = '';
const DEFAULT_PANEL_BG = '';
const DEFAULT_DISABLE_HOVER = false;
const DEFAULT_TEXT_SCALE: TextScale = 1.0;

// ============================================
// Signals
// ============================================

export const itemSpacing = signal<ItemSpacing>(
	getUiSetting<ItemSpacing>('item_spacing', DEFAULT_ITEM_SPACING),
);
export const itemRadius = signal<number>(getUiSetting<number>('item_radius', DEFAULT_ITEM_RADIUS));
export const cardBorder = signal<CardBorder>(
	getUiSetting<CardBorder>('card_border', DEFAULT_CARD_BORDER),
);
export const pageBg = signal<string>(getUiSetting<string>('page_bg', DEFAULT_PAGE_BG));
export const panelBg = signal<string>(getUiSetting<string>('panel_bg', DEFAULT_PANEL_BG));
export const disableHover = signal<boolean>(
	getUiSetting<boolean>('disable_hover', DEFAULT_DISABLE_HOVER),
);
export const textScale = signal<TextScale>(
	getUiSetting<TextScale>('text_scale', DEFAULT_TEXT_SCALE),
);

// ============================================
// Gap map
// ============================================

const ITEM_GAP_MAP: Record<string, string> = {
	none: '0px',
	minimal: '4px',
	compact: '8px',
	normal: '24px',
	comfortable: '32px',
	spaced: '48px',
};

// ============================================
// Helpers
// ============================================

export function cardBorderToCss(b: CardBorder): string {
	const { r, g, bb } = hexToRgbParts(b.color);
	return `${b.width}px solid rgba(${r}, ${g}, ${bb}, ${b.opacity})`;
}

function hexToRgbParts(hex: string): { r: number; g: number; bb: number } {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!m) return { r: 120, g: 140, bb: 180 };
	return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), bb: parseInt(m[3], 16) };
}

// ============================================
// Effects — apply CSS custom properties
// ============================================

effect(() => {
	const root = document.documentElement;
	const gap = ITEM_GAP_MAP[itemSpacing.value] ?? ITEM_GAP_MAP.normal;
	root.style.setProperty('--item-gap', gap);
});

effect(() => {
	const root = document.documentElement;
	const r = itemRadius.value;
	root.style.setProperty('--item-radius', `${r}px`);
});

effect(() => {
	const root = document.documentElement;
	const b = cardBorder.value;
	root.style.setProperty('--card-border', cardBorderToCss(b));
});

effect(() => {
	const root = document.documentElement;
	const bg = pageBg.value;
	if (bg) {
		root.style.setProperty('--color-bg-primary', bg);
	} else {
		root.style.removeProperty('--color-bg-primary');
	}
});

effect(() => {
	const root = document.documentElement;
	const bg = panelBg.value;
	if (bg) {
		root.style.setProperty('--panel-bg', bg);
		root.style.setProperty('--color-bg-surface', bg);
	} else {
		root.style.removeProperty('--panel-bg');
		root.style.removeProperty('--color-bg-surface');
	}
});

effect(() => {
	const root = document.documentElement;
	const scale = textScale.value;
	if (scale !== 1.0) {
		root.style.setProperty('--text-scale', String(scale));
	} else {
		root.style.removeProperty('--text-scale');
	}
});

effect(() => {
	const root = document.documentElement;
	if (disableHover.value) {
		root.dataset.noHover = '';
	} else {
		delete root.dataset.noHover;
	}
});

// ============================================
// Actions
// ============================================

export function setItemSpacing(v: ItemSpacing): void {
	itemSpacing.value = v;
	setUiSetting('item_spacing', v);
}

export function setItemRadius(v: number): void {
	itemRadius.value = v;
	setUiSetting('item_radius', v);
}

export function setCardBorder(v: CardBorder): void {
	cardBorder.value = v;
	setUiSetting('card_border', v);
}

export function setPageBg(v: string): void {
	pageBg.value = v;
	setUiSetting('page_bg', v);
}

export function setPanelBg(v: string): void {
	panelBg.value = v;
	setUiSetting('panel_bg', v);
}

export function setTextScale(v: TextScale): void {
	textScale.value = v;
	setUiSetting('text_scale', v);
}

export function setDisableHover(v: boolean): void {
	disableHover.value = v;
	setUiSetting('disable_hover', v);
}

// ============================================
// Reset functions
// ============================================

export function resetItemSpacing(): void {
	setItemSpacing(DEFAULT_ITEM_SPACING);
}

export function resetItemRadius(): void {
	setItemRadius(DEFAULT_ITEM_RADIUS);
}

export function resetCardBorder(): void {
	setCardBorder({ ...DEFAULT_CARD_BORDER });
}

export function resetPageBg(): void {
	setPageBg('');
}

export function resetPanelBg(): void {
	setPanelBg('');
}

export function resetTextScale(): void {
	setTextScale(DEFAULT_TEXT_SCALE);
}

export function resetDisableHover(): void {
	setDisableHover(DEFAULT_DISABLE_HOVER);
}

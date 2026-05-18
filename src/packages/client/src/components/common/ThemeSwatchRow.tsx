/**
 * Visual swatch row for selecting a theme.
 *
 * Renders a horizontal strip of square-ish previews — each shows the
 * theme's `panelBg`, `accentColor`, and `pageBg` so the user can pick
 * by feel rather than by name in a dropdown. The active theme is
 * outlined with the live accent ring.
 *
 * Designed to sit ABOVE (not replace) the existing `<Select>` —
 * the Select remains for accessibility / keyboard / search, and this
 * provides a faster visual selection path.
 */

import type { ThemeRecord } from '@mu/shared';
import styles from './ThemeSwatchRow.module.scss';

interface ThemeSwatchRowProps {
	themes: ThemeRecord[];
	selectedId: string;
	onSelect: (id: string) => void;
	mode: 'dark' | 'light';
}

export function ThemeSwatchRow({ themes, selectedId, onSelect, mode }: ThemeSwatchRowProps) {
	const filtered = themes.filter((t) => t.mode === mode);
	if (filtered.length === 0) return null;
	return (
		<div class={styles.row} role="radiogroup" aria-label={`${mode} themes`}>
			{filtered.map((t) => {
				const cfg = t.config;
				const isActive = t.id === selectedId;
				return (
					<button
						key={t.id}
						type="button"
						role="radio"
						aria-checked={isActive}
						class={`${styles.swatch} ${isActive ? styles.swatchActive : ''}`}
						title={`${t.name}${t.config.tokens?.['color-accent-secondary'] ? ' · accent + secondary' : ''}`}
						onClick={() => onSelect(t.id)}
						style={{
							background: `linear-gradient(135deg, ${cfg.pageBg} 0%, ${cfg.panelBg} 55%, ${cfg.accentColor} 100%)`,
						}}
					>
						<span class={styles.swatchAccent} style={{ background: cfg.accentColor }} />
						<span class={styles.swatchName}>{t.name}</span>
					</button>
				);
			})}
		</div>
	);
}

import type { ComponentChildren, VNode } from 'preact';
import styles from './Panel.module.scss';

interface PanelProps {
	/** Panel heading (omit for a bare surface). */
	title?: ComponentChildren;
	/** Secondary line under the title. */
	subtitle?: ComponentChildren;
	/** Right-aligned header slot (toggles, counts, actions). */
	actions?: VNode | null;
	children: ComponentChildren;
	class?: string;
	bodyClass?: string;
}

/**
 * A titled surface panel — the Deep Space "section as a panel" building block.
 * Soft card shadow + hairline border + rounded corners; quiet header with the
 * label color. Used to section the profile (info, favorites, history, …) and
 * reusable anywhere a page needs a grouped surface.
 */
export function Panel({
	title,
	subtitle,
	actions,
	children,
	class: cls = '',
	bodyClass = '',
}: PanelProps) {
	const hasHeader = title != null || subtitle != null || actions != null;
	return (
		<section class={`${styles.panel} ${cls}`}>
			{hasHeader && (
				<header class={styles.header}>
					<div class={styles.heading}>
						{title != null && <h2 class={styles.title}>{title}</h2>}
						{subtitle != null && <p class={styles.subtitle}>{subtitle}</p>}
					</div>
					{actions != null && <div class={styles.actions}>{actions}</div>}
				</header>
			)}
			<div class={`${styles.body} ${hasHeader ? '' : styles.bodyFlush} ${bodyClass}`}>
				{children}
			</div>
		</section>
	);
}

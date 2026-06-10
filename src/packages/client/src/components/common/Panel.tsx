import type { ComponentChildren, VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from './Icon';
import styles from './Panel.module.scss';

interface PanelProps {
	/** Header click toggles the body (chevron shown). */
	collapsible?: boolean;
	/** Initial open state for collapsible panels. Default true. */
	defaultOpen?: boolean;
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
	collapsible = false,
	defaultOpen = true,
}: PanelProps) {
	const hasHeader = title != null || subtitle != null || actions != null;
	const [open, setOpen] = useState(defaultOpen);
	const showBody = !collapsible || open;
	return (
		<section class={`${styles.panel} ${cls}`}>
			{hasHeader && (
				<header
					class={`${styles.header} ${collapsible ? styles.headerToggle : ''}`}
					onClick={collapsible ? () => setOpen(!open) : undefined}
				>
					<div class={styles.heading}>
						{title != null && <h2 class={styles.title}>{title}</h2>}
						{subtitle != null && <p class={styles.subtitle}>{subtitle}</p>}
					</div>
					<div class={styles.actions}>
						{actions}
						{collapsible && (
							<span class={styles.chevron}>
								<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
							</span>
						)}
					</div>
				</header>
			)}
			{showBody && (
				<div class={`${styles.body} ${hasHeader ? '' : styles.bodyFlush} ${bodyClass}`}>
					{children}
				</div>
			)}
		</section>
	);
}

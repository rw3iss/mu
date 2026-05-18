import type { ComponentChildren } from 'preact';
import { Button } from './Button';
import styles from './EmptyState.module.scss';
import { Icon, type IconName } from './Icon';

type EmptyVariant = 'plain' | 'dashed' | 'inline';

interface EmptyStateProps {
	/** Either an Icon name or a free-form glyph (emoji). Icon name preferred. */
	icon?: IconName | string;
	title: string;
	message?: string;
	actionLabel?: string;
	onAction?: () => void;
	/** Optional secondary affordance — e.g. a "Learn more" link/button. */
	secondaryLabel?: string;
	onSecondary?: () => void;
	/**
	 * - `plain`   centred block, no border (default).
	 * - `dashed`  dashed-border card — best for "drop a file / nothing
	 *             yet" states inside content panels.
	 * - `inline`  compact, left-aligned, no padding — for narrow rows
	 *             (sidebar empties, list-row empties).
	 */
	variant?: EmptyVariant;
	/** Children rendered after `message` and before the actions — slot for custom content. */
	children?: ComponentChildren;
	class?: string;
}

const ICON_NAMES = new Set<IconName>([
	'eye',
	'eye-off',
	'sun',
	'moon',
	'monitor',
	'chevron-up',
	'chevron-down',
	'chevron-left',
	'chevron-right',
	'arrow-up',
	'arrow-down',
	'arrow-left',
	'arrow-right',
	'arrow-up-right',
	'view-large',
	'view-grid',
	'view-list',
	'edit',
	'check',
	'check-circle',
	'x',
	'x-circle',
	'plus',
	'minus',
	'trash',
	'refresh',
	'search',
	'settings',
	'share',
	'play',
	'pause',
	'layers',
	'home',
	'film',
	'list-plus',
	'star',
	'star-filled',
	'warning',
	'info',
	'image-broken',
]);

export function EmptyState({
	icon,
	title,
	message,
	actionLabel,
	onAction,
	secondaryLabel,
	onSecondary,
	variant = 'plain',
	children,
	class: className = '',
}: EmptyStateProps) {
	const isIconName = typeof icon === 'string' && ICON_NAMES.has(icon as IconName);
	const containerClass = [styles.container, styles[`variant_${variant}`], className]
		.filter(Boolean)
		.join(' ');

	return (
		<div class={containerClass}>
			{icon && (
				<span class={styles.icon} aria-hidden="true">
					{isIconName ? <Icon name={icon as IconName} size={32} /> : icon}
				</span>
			)}
			<h3 class={styles.title}>{title}</h3>
			{message && <p class={styles.message}>{message}</p>}
			{children}
			{(actionLabel || secondaryLabel) && (
				<div class={styles.actions}>
					{actionLabel && onAction && (
						<Button variant="primary" size="md" onClick={onAction}>
							{actionLabel}
						</Button>
					)}
					{secondaryLabel && onSecondary && (
						<Button variant="ghost" size="md" onClick={onSecondary}>
							{secondaryLabel}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

import type { ComponentChildren, JSX, VNode } from 'preact';
import styles from './MediaRow.module.scss';
import { SmartImage } from './SmartImage';

/**
 * MediaRow — generic horizontal list-row shell. Sibling of
 * `<MediaCard>` for surfaces where a column of compact rows reads
 * better than a poster grid (Favorites list view, History rows,
 * Watchlist secondary view, search results in a flyout, etc.).
 *
 * Layout:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ [leading] [thumb] │ title           │ [trailing]/actions│
 *   │                   │ subtitle        │                   │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Composition-only. State flags (`selected`, `dim`, `disabled`,
 * `compact`) cover cross-cutting visual modes; everything else is a
 * slot. Same SOLID stance as MediaCard.
 */

export type MediaRowThumbShape = 'square' | 'circle' | 'poster' | 'backdrop' | 'none';

export interface MediaRowProps {
	/** Image URL passed to SmartImage. When omitted, no thumbnail slot renders (use `leading` for custom). */
	thumbUrl?: string | null;
	/** Alt text for the thumbnail. */
	thumbAlt?: string;
	/** Fallback label shown when the thumbnail is missing/errors. */
	thumbFallbackLabel?: string;
	/** Aspect-ratio / clipping for the thumbnail. Defaults to `square`. */
	thumbShape?: MediaRowThumbShape;

	/** Title — string wraps in default heading; VNode renders verbatim. */
	title?: ComponentChildren;
	/** Subtitle / meta line. */
	subtitle?: ComponentChildren;
	/** Extra row rendered inside `.info` below subtitle. */
	extra?: ComponentChildren;

	/** Slot rendered to the LEFT of the thumbnail (e.g. selection checkbox, drag handle). */
	leading?: VNode | null;
	/** Right-aligned actions (e.g. favorite button, options menu). */
	actions?: ComponentChildren;
	/** Replaces the default info block entirely. */
	children?: ComponentChildren;

	onClick?: (e: MouseEvent) => void;
	disabled?: boolean;
	selected?: boolean;
	dim?: boolean;
	/** Tighter padding + smaller thumbnail. */
	compact?: boolean;

	class?: string;
	style?: JSX.CSSProperties;
	'aria-label'?: string;
}

export function MediaRow({
	thumbUrl,
	thumbAlt,
	thumbFallbackLabel,
	thumbShape = 'square',
	title,
	subtitle,
	extra,
	leading,
	actions,
	children,
	onClick,
	disabled,
	selected,
	dim,
	compact,
	class: className = '',
	style,
	...rest
}: MediaRowProps) {
	const classes = [
		styles.row,
		compact ? styles.compact : '',
		selected ? styles.selected : '',
		dim ? styles.dim : '',
		disabled ? styles.disabled : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	const handleClick = disabled ? undefined : onClick;
	const showThumb = thumbShape !== 'none' && thumbUrl !== undefined;

	return (
		<div
			class={classes}
			style={style}
			onClick={handleClick}
			role={handleClick ? 'button' : undefined}
			tabIndex={handleClick ? 0 : undefined}
			aria-disabled={disabled || undefined}
			{...rest}
		>
			{leading && <div class={styles.leading}>{leading}</div>}
			{showThumb && (
				<div class={`${styles.thumb} ${styles[`shape_${thumbShape}`]}`}>
					{thumbUrl ? (
						<SmartImage
							src={thumbUrl}
							alt={thumbAlt ?? ''}
							imgClass={styles.thumbImg}
							class={styles.thumbInner}
							fallbackLabel={thumbFallbackLabel}
						/>
					) : (
						<div class={styles.thumbFallback}>
							{thumbFallbackLabel?.charAt(0)?.toUpperCase() ?? ''}
						</div>
					)}
				</div>
			)}
			{children ?? (
				<div class={styles.info}>
					{title != null &&
						(typeof title === 'string' || typeof title === 'number' ? (
							<span class={styles.title}>{title}</span>
						) : (
							title
						))}
					{subtitle && <span class={styles.subtitle}>{subtitle}</span>}
					{extra}
				</div>
			)}
			{actions && <div class={styles.actions}>{actions}</div>}
		</div>
	);
}

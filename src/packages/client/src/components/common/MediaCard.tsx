import type { ComponentChildren, JSX, VNode } from 'preact';
import styles from './MediaCard.module.scss';
import { SmartImage } from './SmartImage';

/**
 * MediaCard — generic "poster + info" card shell used across the
 * library, discover, favorites, recommendations grids. Knows
 * nothing about movies/people specifically; consumers pass badges
 * and overlays as slot props.
 *
 * Layout:
 *
 *   ┌─ posterWrap ─────────────────┐  ← topLeft / topRight / posterBadges slots
 *   │                              │
 *   │         <SmartImage>         │
 *   │                              │
 *   │  ─── hoverOverlay (on :hover)│
 *   ├──────────────────────────────┤  ← belowPoster slot (e.g. progress bar)
 *   │  title                       │  ← children optional, replaces info if given
 *   │  subtitle                    │
 *   │  extra                       │
 *   ├── caption (full-width) ──────┤  ← captionSlot (e.g. explanation text)
 *   └──────────────────────────────┘
 *
 * Aspect-ratio is set per `posterShape` — `2/3` (default movie
 * poster), `1/1.4` (person portrait), `1/1` (square), or `16/9`
 * (backdrop).
 *
 * Open/closed: no movie-specific flags. State classes (dim,
 * processing, selected) are exposed as boolean props for
 * cross-cutting visual states; product-specific badges go into
 * the topLeft/topRight/posterBadges slots.
 */

export type MediaCardPosterShape = 'poster' | 'portrait' | 'square' | 'backdrop';

export interface MediaCardProps {
	/** Image URL (passed straight to SmartImage). */
	posterUrl?: string | null;
	/** Alt text for the poster image. */
	alt: string;
	/** Fallback label shown when posterUrl is missing/errors. */
	fallbackLabel?: string;
	/** Aspect ratio of the poster area. */
	posterShape?: MediaCardPosterShape;

	/** Title text or custom node. Required unless `children` replaces the info block. */
	title?: ComponentChildren;
	/** Subtitle / meta — typically a render-prop returning year · runtime · etc. */
	subtitle?: ComponentChildren;
	/** Extra row rendered inside `.info` below subtitle (e.g. options menu). */
	extra?: ComponentChildren;
	/** Caption rendered below `.info` full-width (e.g. discover explanation). */
	caption?: ComponentChildren;

	/** Replaces the entire default info block — escape hatch for fully custom layouts. */
	children?: ComponentChildren;

	/** Top-left badge slot inside the poster (e.g. score percentage). */
	topLeft?: VNode | null;
	/** Top-right badge slot inside the poster (e.g. rating). */
	topRight?: VNode | null;
	/** Extra absolutely-positioned overlays on the poster (e.g. "Not in library"). */
	posterBadges?: ComponentChildren;
	/** Shown on hover/focus over the poster — typically action buttons. */
	hoverOverlay?: ComponentChildren;
	/** Rendered between the poster and the info block (e.g. watch-progress bar). */
	belowPoster?: ComponentChildren;
	/** Rendered above the info block (e.g. checkbox in selection mode). */
	preInfo?: ComponentChildren;

	/** Click on the whole card (typically navigates to detail). */
	onClick?: (e: MouseEvent) => void;
	/** Disables click behaviour and dims the card. */
	disabled?: boolean;
	/** Visual cue: this item is muted (e.g. "not in library"). */
	dim?: boolean;
	/** Renders a "processing" frame overlay. */
	processing?: boolean;
	/** Renders the "selected" frame (bulk selection mode). */
	selected?: boolean;
	/** Renders the "hidden" muted frame. */
	hidden?: boolean;

	/** Extra class appended to the root. */
	class?: string;
	style?: JSX.CSSProperties;
	'aria-label'?: string;
}

export function MediaCard({
	posterUrl,
	alt,
	fallbackLabel,
	posterShape = 'poster',
	title,
	subtitle,
	extra,
	caption,
	children,
	topLeft,
	topRight,
	posterBadges,
	hoverOverlay,
	belowPoster,
	preInfo,
	onClick,
	disabled,
	dim,
	processing,
	selected,
	hidden,
	class: className = '',
	style,
	...rest
}: MediaCardProps) {
	const classes = [
		styles.card,
		styles[`shape_${posterShape}`],
		dim ? styles.dim : '',
		processing ? styles.processing : '',
		selected ? styles.selected : '',
		hidden ? styles.hiddenState : '',
		disabled ? styles.disabled : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	const handleClick = disabled ? undefined : onClick;

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
			<div class={styles.posterWrap}>
				<SmartImage
					src={posterUrl ?? ''}
					alt={alt}
					imgClass={styles.posterImg}
					class={styles.poster}
					fallbackLabel={fallbackLabel}
				/>
				{topLeft && <div class={styles.topLeft}>{topLeft}</div>}
				{topRight && <div class={styles.topRight}>{topRight}</div>}
				{posterBadges}
				{hoverOverlay && <div class={styles.hoverOverlay}>{hoverOverlay}</div>}
			</div>
			{belowPoster}
			{preInfo}
			{children ?? (
				<div class={styles.info}>
					{title != null &&
						(typeof title === 'string' || typeof title === 'number' ? (
							<h3 class={styles.title}>{title}</h3>
						) : (
							title
						))}
					{subtitle && <div class={styles.subtitle}>{subtitle}</div>}
					{extra}
				</div>
			)}
			{caption && <div class={styles.caption}>{caption}</div>}
		</div>
	);
}

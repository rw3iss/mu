import type { ComponentChildren, JSX, VNode } from 'preact';
import { newTabNav } from '@/utils/navigation';
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
	/** Rendered directly under the title (in the top scrim when `infoOverlay`). */
	topMeta?: ComponentChildren;
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
	/**
	 * Suppress the poster's accent border on hover. Cards that already draw
	 * their own border around the WHOLE item (e.g. DiscoverResultCard) would
	 * otherwise show two nested highlights.
	 */
	noPosterHoverBorder?: boolean;
	/** Rendered between the poster and the info block (e.g. watch-progress bar). */
	belowPoster?: ComponentChildren;
	/** Rendered above the info block (e.g. checkbox in selection mode). */
	preInfo?: ComponentChildren;
	/**
	 * Float the title/subtitle/extra block over the bottom of the poster with a
	 * gradient scrim instead of stacking it below. Ignored when `children`
	 * replaces the info block.
	 */
	infoOverlay?: boolean;

	/** Click on the whole card (typically navigates to detail). */
	onClick?: (e: MouseEvent) => void;
	/** Detail URL. When set, middle-click / ctrl-/cmd-click opens it in a new tab. */
	href?: string;
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
	topMeta,
	extra,
	caption,
	children,
	topLeft,
	topRight,
	posterBadges,
	hoverOverlay,
	noPosterHoverBorder,
	belowPoster,
	preInfo,
	infoOverlay,
	onClick,
	href,
	disabled,
	dim,
	processing,
	selected,
	hidden,
	class: className = '',
	style,
	...rest
}: MediaCardProps) {
	const overlayInfo = infoOverlay && !children;

	const classes = [
		styles.card,
		styles[`shape_${posterShape}`],
		dim ? styles.dim : '',
		noPosterHoverBorder ? styles.noPosterHoverBorder : '',
		processing ? styles.processing : '',
		selected ? styles.selected : '',
		hidden ? styles.hiddenState : '',
		disabled ? styles.disabled : '',
		overlayInfo ? styles.hasInfoOverlay : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	const titleEl =
		title != null ? (
			typeof title === 'string' || typeof title === 'number' ? (
				<h3 class={styles.title}>{title}</h3>
			) : (
				title
			)
		) : null;
	const metaEl = (
		<>
			{subtitle && <div class={styles.subtitle}>{subtitle}</div>}
			{extra}
		</>
	);

	const handleClick = disabled ? undefined : onClick;
	// When an href is known, middle-click / ctrl-/cmd-click opens it in a new
	// tab; plain clicks keep the existing SPA navigation. Stays a <div> so nested
	// action buttons don't trigger anchor navigation.
	const navHandlers =
		handleClick && href ? newTabNav(href, handleClick) : { onClick: handleClick };

	return (
		<div
			class={classes}
			style={style}
			{...navHandlers}
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
				{overlayInfo && (
					<>
						{(titleEl || topMeta) && (
							<div class={styles.infoOverlayTop}>
								{titleEl}
								{topMeta}
							</div>
						)}
						<div class={styles.infoOverlayBlock}>{metaEl}</div>
						{belowPoster}
					</>
				)}
			</div>
			{!overlayInfo && belowPoster}
			{preInfo}
			{children ??
				(overlayInfo ? null : (
					<div class={styles.info}>
						{titleEl}
						{topMeta}
						{metaEl}
					</div>
				))}
			{caption && <div class={styles.caption}>{caption}</div>}
		</div>
	);
}

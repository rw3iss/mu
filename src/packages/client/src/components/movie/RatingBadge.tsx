import { JSX } from 'preact';
import { getRatingColor } from '@/utils/rating-color';

interface RatingBadgeProps {
	value: number;
	/** Class to apply for positioning / sizing (each card variant has its own). */
	class?: string;
	/** Extra inline style; merged after the background-color from the rating. */
	style?: JSX.CSSProperties;
}

/**
 * Renders a movie rating chip. Returns null when value <= 0 so callers
 * don't have to gate it themselves. Designed as a drop-in for the
 * `{rating > 0 && <span class={ratingBadge} style={{background: ratingColor}}>{rating.toFixed(1)}</span>}`
 * pattern that was duplicated across MovieCard / MovieLargeCard / MovieListItem.
 */
export function RatingBadge({ value, class: className, style }: RatingBadgeProps) {
	if (value <= 0) return null;
	const background = getRatingColor(value);
	return (
		<span class={className} style={{ background, ...style }}>
			{value.toFixed(1)}
		</span>
	);
}

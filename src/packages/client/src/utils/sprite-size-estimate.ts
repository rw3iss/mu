import type { ThumbnailSize } from '@mu/shared';

/**
 * Average sprite-sheet collection size per movie at each thumbnail
 * size, in MB. Derived from a real ~2-hour movie on the production
 * library (24 sheets per size × 10×10 frames per sheet, JPEG q=5):
 *
 *   large = 13 MB (measured), xlarge = 20 MB (measured)
 *
 * Small / medium aren't measured because the default config only
 * generates large + xlarge eagerly. We estimate them from the
 * area ratio (JPEG size scales ~linearly with pixel area for
 * similar content): width² ÷ 360².
 *
 *   small  = (120 / 360)² × 13 ≈ 1.4 MB
 *   medium = (240 / 360)² × 13 ≈ 5.8 MB
 *
 * Rounded for a stable label that doesn't bounce around.
 */
const PER_MOVIE_MB: Record<ThumbnailSize, number> = {
	small: 2,
	medium: 6,
	large: 13,
	xlarge: 20,
};

function formatBytes(mb: number): string {
	if (mb >= 1024) {
		const gb = mb / 1024;
		// 0.X GB once we cross 1 GB, integer once we're past 10 GB.
		return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
	}
	return `${Math.round(mb)} MB`;
}

export interface SpriteSizeEstimate {
	perMovieMb: number;
	perMovieLabel: string;
	totalMb: number;
	totalLabel: string;
}

/**
 * Estimate the disk footprint of the seek-thumbnail sprite cache at
 * a given size, for a library of `movieCount` titles. Used by the
 * Settings > Library > Thumbnail Size sublabel so the user can see
 * the trade-off before they pick.
 */
export function estimateSpriteLibrarySize(
	movieCount: number,
	size: ThumbnailSize,
): SpriteSizeEstimate {
	const perMovieMb = PER_MOVIE_MB[size];
	const totalMb = Math.max(0, movieCount) * perMovieMb;
	return {
		perMovieMb,
		perMovieLabel: `${perMovieMb} MB`,
		totalMb,
		totalLabel: formatBytes(totalMb),
	};
}

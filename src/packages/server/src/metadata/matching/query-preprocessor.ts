import path from 'node:path';
import { parseSeasonEpisode, sanitiseRawTitle } from '../../grouping/title-sanitiser.js';
import { extractYear } from './year-extractor.js';

/**
 * Decision the preprocessor lands on. The metadata service branches on
 * `kind` to pick the right provider search path.
 *
 *  - `movie`       → regular movie lookup against TMDB /search/movie
 *                    and OMDB title search.
 *  - `tv-episode`  → TMDB /search/tv on `showTitle`, then resolve the
 *                    specific episode via
 *                    /tv/{id}/season/{n}/episode/{e}.
 */
export type TitleQuery =
	| {
			kind: 'movie';
			title: string;
			sanitisedTitle: string;
			year: number | null;
			durationMinutes: number | null;
	  }
	| {
			kind: 'tv-episode';
			showTitle: string;
			season: number;
			episode: number;
			year: number | null;
	  };

export interface BuildTitleQueryInput {
	storedTitle: string;
	storedYear: number | null;
	filePath: string | null;
	fileName: string | null;
	durationSeconds: number | null;
}

/**
 * Build a normalised query from a movie row + its file. The point of
 * this layer is to recover what the user actually has on disk:
 *
 *  - A `Goliath - S01E05` row paired with `Goliath.S01E05.*.mkv`
 *    becomes a `tv-episode` query against the show "Goliath".
 *  - A noisy `Inception.2010.1080p.BluRay.x264.mkv` becomes a `movie`
 *    query whose search term is "inception" (sanitised), with year
 *    2010 recovered from the filename.
 *
 * Source-of-truth precedence for the SE marker check: filename →
 * stored title. Filenames usually carry the canonical SxxEyy pattern
 * verbatim; user-edited titles sometimes don't.
 */
export function buildTitleQuery(input: BuildTitleQueryInput): TitleQuery {
	const { storedTitle, storedYear, filePath, fileName, durationSeconds } = input;
	const durationMinutes = durationSeconds ? Math.round(durationSeconds / 60) : null;
	const year =
		extractYear({
			storedYear,
			filePath,
			folderPath: filePath ? path.dirname(filePath) : null,
		}) ?? null;

	// SE detection — try the filename first (canonical), then the title.
	const se =
		(fileName && parseSeasonEpisode(fileName)) ||
		parseSeasonEpisode(storedTitle) ||
		null;

	if (se && se.prefix.trim().length > 0) {
		// Show-name candidate: whatever sat before the SE marker.
		// Run it through the same sanitiser the grouping pipeline uses
		// so "Goliath.SEASON.01.S01.COMPLETE.1080p" → "goliath".
		const showRaw = se.prefix.replace(/[.\-_]+$/, '').trim();
		const showTitle = sanitiseRawTitle(showRaw) || showRaw;
		return {
			kind: 'tv-episode',
			showTitle,
			season: se.season,
			episode: se.episode,
			year,
		};
	}

	return {
		kind: 'movie',
		title: storedTitle,
		sanitisedTitle: sanitiseRawTitle(storedTitle) || storedTitle,
		year,
		durationMinutes,
	};
}

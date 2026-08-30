import { route } from 'preact-router';
import { MediaCard } from '@/components/common/MediaCard';
import { MovieScoreChips } from '@/components/movie/MovieScoreChips';
import styles from './ResultCard.module.scss';

export interface ResultCardProps {
	/** Detail-page URL. Drives click + middle-click / ctrl-click. */
	href: string;
	title: string;
	year?: number | null;
	posterUrl?: string | null;
	/** Drives the "Not in library" badge and the dimmed treatment. */
	inLibrary: boolean;
	/** Relevance 0-100, shown bottom-left. Omit where there's no score. */
	matchPercent?: number | null;
	imdbRating?: number | null;
	imdbVotes?: number | null;
	tmdbRating?: number | null;
	tmdbVotes?: number | null;
	rtRating?: number | null;
	metacriticRating?: number | null;
	runtimeMinutes?: number | null;
	genres?: string[] | null;
	/** Person-page context, e.g. "as Francis" or "Director". */
	role?: string | null;
	/**
	 * Discover seed key — a local movie id, or `tmdb:<id>` for titles that
	 * aren't in the library. Renders the hover "See similar" button.
	 */
	seedId?: string | null;
	/** Extra badges for the poster's top-left (e.g. "Enriching…"). */
	topLeftExtra?: preact.ComponentChildren;
}

/**
 * The shared movie-result card used by the movie page's "Similar" section and
 * the person page's "Known For" rail, so both show the same information laid
 * out the same way.
 *
 * Layout:
 *   poster  → ★ best-rating (top-right), "Not in library" (top-left),
 *             relevance % (bottom-left), "See similar" on hover
 *   info    → title, then year · runtime · genre, then the rating chips on
 *             their own row (same brand colours as the Library cards)
 *   caption → the full genre list
 */
export function ResultCard({
	href,
	title,
	year,
	posterUrl,
	inLibrary,
	matchPercent,
	imdbRating,
	imdbVotes,
	tmdbRating,
	tmdbVotes,
	rtRating,
	metacriticRating,
	runtimeMinutes,
	genres,
	role,
	seedId,
	topLeftExtra,
}: ResultCardProps) {
	const imdb = imdbRating && imdbRating > 0 ? imdbRating : null;
	const tmdb = tmdbRating && tmdbRating > 0 ? tmdbRating : null;
	// One headline number on the poster; the chip row carries the breakdown.
	const topRating = imdb ?? tmdb;
	const runtimeLabel =
		runtimeMinutes && runtimeMinutes > 0 ? formatRuntime(runtimeMinutes) : null;
	const primaryGenre = genres?.[0] ?? null;
	const pct = matchPercent != null ? Math.round(matchPercent) : null;

	const topLeft = (
		<>
			{!inLibrary && <span class={styles.notInLibrary}>Not in library</span>}
			{topLeftExtra}
		</>
	);

	// Plain content — MediaCard's .topRight slot is already absolutely placed,
	// so positioning here too would nest the badge in an auto-width box and wrap
	// the star onto its own line.
	const topRight =
		topRating != null ? (
			<span class={styles.ratingBadge}>
				<span class={styles.star}>★</span>
				{topRating.toFixed(1)}
			</span>
		) : null;

	return (
		<MediaCard
			posterUrl={posterUrl ?? ''}
			alt={title}
			fallbackLabel={title.charAt(0)}
			posterShape="poster"
			href={href}
			onClick={() => route(href)}
			dim={!inLibrary}
			class={styles.card}
			noPosterHoverBorder
			topLeft={topLeft}
			topRight={topRight}
			posterBadges={
				pct != null && pct > 0 ? <span class={styles.matchBadge}>{pct}%</span> : null
			}
			hoverOverlay={
				seedId ? (
					<button
						type="button"
						class={styles.seedBtn}
						onClick={(e: MouseEvent) => {
							e.preventDefault();
							e.stopPropagation();
							route(
								`/discover?seedMovieId=${encodeURIComponent(seedId)}&seedLabel=${encodeURIComponent(title)}`,
							);
						}}
						title={`Find movies similar to ${title}`}
					>
						See similar →
					</button>
				) : null
			}
			title={title}
			subtitle={
				<>
					<span class={styles.metaRow}>
						<span>{year ?? '—'}</span>
						{runtimeLabel && <span>{runtimeLabel}</span>}
						{primaryGenre && (
							<span
								title={genres && genres.length > 1 ? genres.join(' · ') : undefined}
							>
								{primaryGenre}
							</span>
						)}
						{role && <span class={styles.role}>{role}</span>}
					</span>
					<span class={styles.chipRow}>
						<MovieScoreChips
							movie={{
								imdbRating: imdb ?? undefined,
								imdbVotes: imdbVotes ?? undefined,
								rtRating: rtRating ?? undefined,
								metacriticRating: metacriticRating ?? undefined,
								tmdbRating: tmdb,
								tmdbVotes: tmdbVotes,
							}}
						/>
					</span>
				</>
			}
			caption={genres && genres.length > 0 ? genres.join(', ') : null}
		/>
	);
}

function formatRuntime(min: number): string {
	if (min >= 60) {
		const h = Math.floor(min / 60);
		const m = min % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
	return `${min}m`;
}

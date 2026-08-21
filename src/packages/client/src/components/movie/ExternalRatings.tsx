import styles from './ExternalRatings.module.scss';

interface ExternalRatingsProps {
	imdbRating?: number;
	rtRating?: number;
	metacriticRating?: number;
	imdbId?: string;
	imdbVotes?: number;
	/** TMDB score + vote count. Often the ONLY rating available — a movie that
	 *  isn't in the library yet is seeded from TMDB, and its OMDB-sourced
	 *  IMDb/RT/Metacritic scores arrive on a later refresh (or never). */
	tmdbRating?: number;
	tmdbVotes?: number;
	/** TMDB id, so the score can link back to the source. */
	tmdbId?: number;
}

/** Compact vote count: 1.2M / 43.5K / 643. */
function formatVotes(votes: number): string {
	if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
	if (votes >= 1000) return `${(votes / 1000).toFixed(1)}K`;
	return String(votes);
}

export function ExternalRatings({
	imdbRating,
	rtRating,
	metacriticRating,
	imdbId,
	imdbVotes,
	tmdbRating,
	tmdbVotes,
	tmdbId,
}: ExternalRatingsProps) {
	const hasAny =
		imdbRating !== undefined ||
		rtRating !== undefined ||
		metacriticRating !== undefined ||
		tmdbRating !== undefined ||
		imdbId;

	if (!hasAny) {
		return null;
	}

	const imdbUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/` : null;
	const tmdbUrl = tmdbId ? `https://www.themoviedb.org/movie/${tmdbId}` : null;
	// Show whichever vote count belongs to a score we're actually displaying,
	// preferring IMDb (the larger, more familiar sample).
	const votes =
		imdbRating !== undefined && imdbVotes != null && imdbVotes > 0
			? { count: imdbVotes, source: 'IMDb' }
			: tmdbRating !== undefined && tmdbVotes != null && tmdbVotes > 0
				? { count: tmdbVotes, source: 'TMDB' }
				: null;

	return (
		<div class={styles.ratings}>
			{imdbRating !== undefined && imdbUrl ? (
				<a
					href={imdbUrl}
					target="_blank"
					rel="noopener noreferrer"
					class={`${styles.badge} ${styles.imdb} ${styles.link}`}
				>
					<span class={styles.source}>IMDb</span>
					<span class={styles.score}>{imdbRating.toFixed(1)}</span>
				</a>
			) : imdbRating !== undefined ? (
				<div class={`${styles.badge} ${styles.imdb}`}>
					<span class={styles.source}>IMDb</span>
					<span class={styles.score}>{imdbRating.toFixed(1)}</span>
				</div>
			) : imdbUrl ? (
				<a
					href={imdbUrl}
					target="_blank"
					rel="noopener noreferrer"
					class={`${styles.badge} ${styles.imdb} ${styles.link}`}
				>
					<span class={styles.source}>IMDb</span>
				</a>
			) : null}

			{tmdbRating !== undefined &&
				(tmdbUrl ? (
					<a
						href={tmdbUrl}
						target="_blank"
						rel="noopener noreferrer"
						class={`${styles.badge} ${styles.tmdb} ${styles.link}`}
					>
						<span class={styles.source}>TMDB</span>
						<span class={styles.score}>{tmdbRating.toFixed(1)}</span>
					</a>
				) : (
					<div class={`${styles.badge} ${styles.tmdb}`}>
						<span class={styles.source}>TMDB</span>
						<span class={styles.score}>{tmdbRating.toFixed(1)}</span>
					</div>
				))}

			{rtRating !== undefined && (
				<div
					class={`${styles.badge} ${styles.rt} ${
						rtRating >= 60 ? styles.fresh : styles.rotten
					}`}
				>
					<span class={styles.source}>RT</span>
					<span class={styles.score}>{rtRating}%</span>
				</div>
			)}

			{metacriticRating !== undefined && (
				<div
					class={`${styles.badge} ${styles.metacritic} ${
						metacriticRating >= 61
							? styles.favorable
							: metacriticRating >= 40
								? styles.mixed
								: styles.unfavorable
					}`}
				>
					<span class={styles.source}>MC</span>
					<span class={styles.score}>{metacriticRating}</span>
				</div>
			)}
			{votes && (
				<span class={styles.votes} title={`${votes.source} votes`}>
					{formatVotes(votes.count)} votes
				</span>
			)}
		</div>
	);
}

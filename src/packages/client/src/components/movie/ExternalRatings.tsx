import styles from './ExternalRatings.module.scss';

interface ExternalRatingsProps {
	imdbRating?: number;
	rtRating?: number;
	metacriticRating?: number;
	imdbId?: string;
}

export function ExternalRatings({ imdbRating, rtRating, metacriticRating, imdbId }: ExternalRatingsProps) {
	const hasAny =
		imdbRating !== undefined || rtRating !== undefined || metacriticRating !== undefined || imdbId;

	if (!hasAny) {
		return null;
	}

	const imdbUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/` : null;

	return (
		<div class={styles.ratings}>
			{imdbRating !== undefined && imdbUrl ? (
				<a href={imdbUrl} target="_blank" rel="noopener noreferrer" class={`${styles.badge} ${styles.imdb} ${styles.link}`}>
					<span class={styles.source}>IMDb</span>
					<span class={styles.score}>{imdbRating.toFixed(1)}</span>
				</a>
			) : imdbRating !== undefined ? (
				<div class={`${styles.badge} ${styles.imdb}`}>
					<span class={styles.source}>IMDb</span>
					<span class={styles.score}>{imdbRating.toFixed(1)}</span>
				</div>
			) : imdbUrl ? (
				<a href={imdbUrl} target="_blank" rel="noopener noreferrer" class={`${styles.badge} ${styles.imdb} ${styles.link}`}>
					<span class={styles.source}>IMDb</span>
				</a>
			) : null}

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
		</div>
	);
}

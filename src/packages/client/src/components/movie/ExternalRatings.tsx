import styles from './ExternalRatings.module.scss';

interface ExternalRatingsProps {
	imdbRating?: number;
	rtRating?: number;
	metacriticRating?: number;
}

export function ExternalRatings({ imdbRating, rtRating, metacriticRating }: ExternalRatingsProps) {
	const hasAny =
		imdbRating !== undefined || rtRating !== undefined || metacriticRating !== undefined;

	if (!hasAny) {
		return null;
	}

	return (
		<div class={styles.ratings}>
			{imdbRating !== undefined && (
				<div class={`${styles.badge} ${styles.imdb}`}>
					<span class={styles.source}>IMDb</span>
					<span class={styles.score}>{imdbRating.toFixed(1)}</span>
				</div>
			)}

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

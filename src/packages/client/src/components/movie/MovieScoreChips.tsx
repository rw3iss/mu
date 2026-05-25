import type { Movie } from '@/state/library.state';
import styles from './MovieScoreChips.module.scss';

/**
 * Compact external-score chips for movie cards.
 *
 * Renders one inline span per source the movie has data for: IMDb (with
 * rating + abbreviated vote count), Rotten Tomatoes (critic %), Metacritic.
 * Returns null when no scores are available so callers don't have to gate.
 *
 * The chips are intentionally text-only (no separators of their own) — the
 * surrounding meta row's adjacency rule (`span + span::before { content: '·' }`)
 * supplies the dots between them.
 */
interface MovieScoreChipsProps {
	movie: Pick<Movie, 'imdbRating' | 'imdbVotes' | 'rtRating' | 'metacriticRating'>;
}

export function MovieScoreChips({ movie }: MovieScoreChipsProps) {
	const imdb = movie.imdbRating && movie.imdbRating > 0 ? movie.imdbRating : null;
	const imdbVotes =
		movie.imdbVotes && movie.imdbVotes > 0 ? movie.imdbVotes : null;
	const rt = movie.rtRating && movie.rtRating > 0 ? movie.rtRating : null;
	const mc =
		movie.metacriticRating && movie.metacriticRating > 0 ? movie.metacriticRating : null;

	if (imdb == null && rt == null && mc == null) return null;

	return (
		<>
			{imdb != null && (
				<span
					class={styles.score}
					title={
						imdbVotes != null
							? `IMDb ${imdb.toFixed(1)} from ${imdbVotes.toLocaleString()} votes`
							: `IMDb ${imdb.toFixed(1)}`
					}
				>
					<span class={`${styles.tag} ${styles.imdb}`}>IMDb</span>
					{imdb.toFixed(1)}
					{imdbVotes != null && <span class={styles.votes}> ({formatVotes(imdbVotes)})</span>}
				</span>
			)}
			{rt != null && (
				<span class={styles.score} title={`Rotten Tomatoes ${rt}%`}>
					<span class={`${styles.tag} ${styles.rt}`}>RT</span>
					{rt}%
				</span>
			)}
			{mc != null && (
				<span class={styles.score} title={`Metacritic ${mc}/100`}>
					<span class={`${styles.tag} ${styles.mc}`}>MC</span>
					{mc}
				</span>
			)}
		</>
	);
}

function formatVotes(n: number): string {
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`;
	}
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

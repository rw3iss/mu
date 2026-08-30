import type { Movie } from '@/state/library.state';
import styles from './MovieScoreChips.module.scss';

/**
 * Compact external-score chips for movie cards.
 *
 * Each chip is a single brand-coloured pill containing ONLY the numeric
 * score. The provider name + vote count live in the native browser
 * tooltip (title attribute) so the row stays dense while still being
 * discoverable on hover.
 *
 * Format inside the chip:
 *   IMDb  → "7.3"           (0-10 scale)
 *   RT    → "78"            (0-100 scale, % implied by red chip colour)
 *   MC    → "75"            (0-100 scale, /100 implied by green chip colour)
 *
 * Tooltip:
 *   "IMDB: 7.3 (40k votes)" / "IMDB: 7.3" if vote count missing
 *   "RT: 78%"
 *   "MC: 75/100"
 *
 * Returns null when no scores are available so callers don't have to gate.
 */
interface MovieScoreChipsProps {
	movie: Pick<Movie, 'imdbRating' | 'imdbVotes' | 'rtRating' | 'metacriticRating'> & {
		/** TMDB score + votes. Often the ONLY rating on a not-in-library title. */
		tmdbRating?: number | null;
		tmdbVotes?: number | null;
	};
}

export function MovieScoreChips({ movie }: MovieScoreChipsProps) {
	const imdb = movie.imdbRating && movie.imdbRating > 0 ? movie.imdbRating : null;
	const imdbVotes = movie.imdbVotes && movie.imdbVotes > 0 ? movie.imdbVotes : null;
	const rt = movie.rtRating && movie.rtRating > 0 ? movie.rtRating : null;
	const mc = movie.metacriticRating && movie.metacriticRating > 0 ? movie.metacriticRating : null;
	const tmdb = movie.tmdbRating && movie.tmdbRating > 0 ? movie.tmdbRating : null;
	const tmdbVotes = movie.tmdbVotes && movie.tmdbVotes > 0 ? movie.tmdbVotes : null;

	if (imdb == null && rt == null && mc == null && tmdb == null) return null;

	return (
		<>
			{imdb != null && (
				<span
					class={`${styles.chip} ${styles.imdb}`}
					title={
						imdbVotes != null
							? `IMDB: ${imdb.toFixed(1)} (${formatVotes(imdbVotes)} votes)`
							: `IMDB: ${imdb.toFixed(1)}`
					}
				>
					{imdb.toFixed(1)}
				</span>
			)}
			{rt != null && (
				<span class={`${styles.chip} ${styles.rt}`} title={`RT: ${rt}%`}>
					{rt}
				</span>
			)}
			{mc != null && (
				<span class={`${styles.chip} ${styles.mc}`} title={`MC: ${mc}/100`}>
					{mc}
				</span>
			)}
			{tmdb != null && (
				<span
					class={`${styles.chip} ${styles.tmdb}`}
					title={
						tmdbVotes != null
							? `TMDB: ${tmdb.toFixed(1)} (${formatVotes(tmdbVotes)} votes)`
							: `TMDB: ${tmdb.toFixed(1)}`
					}
				>
					{tmdb.toFixed(1)}
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

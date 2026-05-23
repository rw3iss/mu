import { useState } from 'preact/hooks';
import { route } from 'preact-router';
import { MediaCard } from '@/components/common/MediaCard';
import { bookmarksService, type ScoredMovie } from '@/services/discover.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './DiscoverResultCard.module.scss';

interface DiscoverResultCardProps {
	movie: ScoredMovie;
	onSeed?: () => void;
}

/**
 * Discover-page card. Composes `<MediaCard>` and slots in
 * discover-specific affordances: relevance score, IMDB/TMDB
 * rating, "Not in library" pill, hover bar with seed +
 * bookmark, and the top explanation as the caption.
 *
 * Click target lands on `/movie/:id` — library + not-owned
 * movies share the same detail route; that page renders in
 * "preview" mode for non-library items.
 */
export function DiscoverResultCard({ movie, onSeed }: DiscoverResultCardProps) {
	const isOwned = movie.inLibrary ?? movie.source === 'library' ?? true;
	const [bookmarked, setBookmarked] = useState<boolean>(movie.source === 'bookmark');
	const [busy, setBusy] = useState(false);

	const goToDetail = () => {
		route(`/movie/${movie.movieId}`);
	};

	const handleSeed = (e: MouseEvent) => {
		e.stopPropagation();
		if (onSeed) onSeed();
		else route(`/discover?seedMovieId=${encodeURIComponent(movie.movieId)}`);
	};

	const handleBookmark = async (e: MouseEvent) => {
		e.stopPropagation();
		if (busy) return;
		setBusy(true);
		try {
			if (bookmarked) {
				await bookmarksService.remove(movie.movieId);
				setBookmarked(false);
				notifySuccess(`Removed bookmark: ${movie.title}`);
			} else {
				await bookmarksService.add({
					tmdbId: movie.tmdbId ?? null,
					title: movie.title,
					year: movie.year,
				});
				setBookmarked(true);
				notifySuccess(`Bookmarked: ${movie.title}`);
			}
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed');
		} finally {
			setBusy(false);
		}
	};

	const scorePct = Math.round(movie.score * 100);
	const reason = movie.explanation[0];
	const tmdb =
		movie.tmdbRating != null && movie.tmdbRating > 0 ? movie.tmdbRating : null;
	const imdb =
		movie.imdbRating != null && movie.imdbRating > 0 ? movie.imdbRating : null;
	// Top-right poster badge highlights the *highest* available rating
	// so the card has a single eye-catching number; the subtitle row
	// shows the full breakdown.
	const topRating = tmdb != null || imdb != null ? Math.max(tmdb ?? 0, imdb ?? 0) : null;
	const votesLabel = movie.votes != null && movie.votes > 0 ? formatVotes(movie.votes) : null;

	const topLeft = (
		<>
			{scorePct > 0 && <span class={styles.scoreBadge}>{scorePct}%</span>}
			{!isOwned && <span class={styles.notOwnedBadge}>Not in library</span>}
			{movie.enriching && <span class={styles.enrichingBadge}>Enriching…</span>}
		</>
	);

	const topRight =
		topRating != null ? (
			<span
				class={styles.ratingBadge}
				title={[
					imdb != null ? `IMDB ${imdb.toFixed(1)}` : null,
					tmdb != null ? `TMDB ${tmdb.toFixed(1)}` : null,
					votesLabel ? `${votesLabel} votes` : null,
				]
					.filter(Boolean)
					.join(' · ')}
			>
				★ {topRating.toFixed(1)}
			</span>
		) : null;

	const hoverOverlay = (
		<>
			<button class={styles.seedBtn} onClick={handleSeed} title="See similar">
				See similar →
			</button>
			{!isOwned && (
				<button
					class={`${styles.bookmarkBtn} ${bookmarked ? styles.bookmarkBtnActive : ''}`}
					onClick={handleBookmark}
					title={bookmarked ? 'Remove bookmark' : 'Bookmark for later'}
					disabled={busy}
				>
					{bookmarked ? '★ Saved' : '☆ Save'}
				</button>
			)}
		</>
	);

	const subtitle = (
		<>
			<span>{movie.year ?? '—'}</span>
			{imdb != null && (
				<span class={styles.metaPill} title="IMDB rating">
					IMDB {imdb.toFixed(1)}
				</span>
			)}
			{tmdb != null && (
				<span class={styles.metaPill} title="TMDB rating">
					TMDB {tmdb.toFixed(1)}
				</span>
			)}
			{votesLabel && <span class={styles.metaPillMuted}>{votesLabel} votes</span>}
			{movie.usedSources.length > 0 && (
				<span class={styles.sources}>{movie.usedSources.slice(0, 2).join(' · ')}</span>
			)}
		</>
	);

	return (
		<MediaCard
			posterUrl={movie.posterUrl ?? ''}
			alt={movie.title}
			fallbackLabel={movie.title.charAt(0)}
			posterShape="poster"
			onClick={goToDetail}
			dim={!isOwned}
			class={styles.card}
			topLeft={topLeft}
			topRight={topRight}
			hoverOverlay={hoverOverlay}
			title={movie.title}
			subtitle={subtitle}
			caption={reason}
		/>
	);
}

function formatVotes(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

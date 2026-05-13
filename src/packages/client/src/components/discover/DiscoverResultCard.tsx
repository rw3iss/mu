import { useState } from 'preact/hooks';
import { route } from 'preact-router';
import { SmartImage } from '@/components/common/SmartImage';
import { bookmarksService, type ScoredMovie } from '@/services/discover.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './DiscoverResultCard.module.scss';

interface DiscoverResultCardProps {
	movie: ScoredMovie;
	onSeed?: () => void;
}

/**
 * Discover-page card variant. Adds: relevance score badge, top
 * explanation as a caption, "See similar to this" link, and a click
 * target that opens the movie detail page.
 *
 * Tries to use the same dimensions as a standard MovieCard so the
 * grid lines up next to one if needed.
 */
export function DiscoverResultCard({ movie, onSeed }: DiscoverResultCardProps) {
	const isOwned = movie.inLibrary ?? movie.source === 'library' ?? true;
	const [bookmarked, setBookmarked] = useState<boolean>(movie.source === 'bookmark');
	const [busy, setBusy] = useState(false);

	const goToDetail = () => {
		if (!isOwned) return;
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

	return (
		<div
			class={`${styles.card} ${!isOwned ? styles.notOwned : ''}`}
			onClick={goToDetail}
			role="button"
			tabIndex={0}
		>
			<div class={styles.posterWrap}>
				{scorePct > 0 && <span class={styles.scoreBadge}>{scorePct}%</span>}
				{!isOwned && <span class={styles.notOwnedBadge}>Not in library</span>}
				{movie.enriching && <span class={styles.enrichingBadge}>Enriching…</span>}
				<SmartImage
					src={movie.posterUrl ?? ''}
					alt={movie.title}
					class={styles.poster}
					fallback={<div class={styles.posterFallback}>{movie.title.charAt(0)}</div>}
				/>
				<div class={styles.hoverBar}>
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
				</div>
			</div>
			<div class={styles.body}>
				<div class={styles.title}>{movie.title}</div>
				<div class={styles.meta}>
					{movie.year ?? '—'}
					{movie.usedSources.length > 0 && (
						<span class={styles.sources}>{movie.usedSources.slice(0, 2).join(' · ')}</span>
					)}
				</div>
				{reason && <div class={styles.reason}>{reason}</div>}
			</div>
		</div>
	);
}

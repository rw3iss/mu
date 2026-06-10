import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { commentsService, type UserCommentRow } from '@/services/comments.service';
import { newTabNav } from '@/utils/navigation';
import { relativeTime } from '@/utils/time-format';
import styles from './ProfileComments.module.scss';

function fmtTime(t: number): string {
	const s = Math.max(0, Math.floor(t));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A user's comments across all movies — poster, title, optional time chip,
 * date, and the comment text. Clicking a row jumps to that comment in the
 * movie's Comments section. Paged 20 at a time via "Load more".
 */
export function ProfileComments({ userId }: { userId: string }) {
	const [rows, setRows] = useState<UserCommentRow[]>([]);
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);

	const load = useCallback(
		async (p: number) => {
			setLoading(true);
			try {
				const r = await commentsService.listByUser(userId, p, 20);
				setRows((prev) => (p === 1 ? r.comments : [...prev, ...r.comments]));
				setHasMore(r.hasMore);
				setPage(p);
			} catch {
				// non-critical
			} finally {
				setLoading(false);
			}
		},
		[userId],
	);

	useEffect(() => {
		load(1);
	}, [load]);

	if (loading && rows.length === 0) return <div class={styles.empty}>Loading…</div>;
	if (rows.length === 0) return <div class={styles.empty}>No comments yet.</div>;

	return (
		<div class={styles.root}>
			<ul class={styles.list}>
				{rows.map((c) => {
					const href = `/movie/${c.movieId}?comment=${c.id}`;
					return (
						<li key={c.id}>
							<button class={styles.item} {...newTabNav(href, () => route(href))}>
								<div class={styles.poster}>
									{c.moviePosterUrl || c.movieThumbnailUrl ? (
										<img
											src={(c.moviePosterUrl || c.movieThumbnailUrl)!}
											alt=""
											loading="lazy"
										/>
									) : (
										<div class={styles.posterFallback} />
									)}
								</div>
								<div class={styles.info}>
									<div class={styles.movieRow}>
										<span class={styles.movieTitle}>
											{c.movieTitle ?? 'Unknown movie'}
										</span>
										{c.timeSeconds != null && (
											<span class={styles.timeChip}>
												{fmtTime(c.timeSeconds)}
											</span>
										)}
									</div>
									<span
										class={styles.when}
										title={new Date(c.createdAt).toLocaleString()}
									>
										{relativeTime(c.createdAt)}
										{c.edited ? ' · edited' : ''}
									</span>
									<p class={styles.text}>{c.text}</p>
								</div>
							</button>
						</li>
					);
				})}
			</ul>
			{hasMore && (
				<Button variant="ghost" size="sm" loading={loading} onClick={() => load(page + 1)}>
					Load more
				</Button>
			)}
		</div>
	);
}

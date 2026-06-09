import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { SmartImage } from '@/components/common/SmartImage';
import { Spinner } from '@/components/common/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { type MetadataSearchCandidate, moviesService } from '@/services/movies.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './MetadataSearchModal.module.scss';

/** Stable per-row key — OMDb candidates have no tmdbId, so fall back to imdbId. */
function candidateKey(c: MetadataSearchCandidate): string {
	return `${c.provider}:${c.tmdbId ?? c.imdbId ?? c.title}`;
}

/**
 * Session-lived SWR cache, keyed by normalized query. Lets a repeated search
 * render instantly from cache while it revalidates in the background, and lets
 * a transient provider failure (empty result) fall back to the last good hits
 * instead of flashing "No matches found". The server/provider layer also caches
 * by query, so the revalidation itself is usually a warm hit.
 */
const searchCache = new Map<string, MetadataSearchCandidate[]>();

interface MetadataSearchModalProps {
	isOpen: boolean;
	onClose: () => void;
	movieId: string;
	/** Seeds the search box (the movie's current title). */
	initialQuery?: string;
	/** Called after a result is assigned so the page can refresh. */
	onAssigned?: () => void;
}

/**
 * "Search for Metadata" — free-text search across both providers (TMDB + OMDb/
 * IMDb) showing candidate movies as rows; selecting one assigns its full
 * metadata to the current movie (the backend applies it via the same merge path
 * as auto-match — TMDB + OMDb merged — caching provider details so no extra API
 * calls are made on assign).
 */
export function MetadataSearchModal({
	isOpen,
	onClose,
	movieId,
	initialQuery,
	onAssigned,
}: MetadataSearchModalProps) {
	const [query, setQuery] = useState('');
	const debounced = useDebounce(query, 200);
	const [results, setResults] = useState<MetadataSearchCandidate[]>([]);
	const [loading, setLoading] = useState(false);
	// Keyed by provider:id since OMDb candidates have no tmdbId.
	const [assigningKey, setAssigningKey] = useState<string | null>(null);

	// Seed the box with the movie title each time the modal opens.
	useEffect(() => {
		if (isOpen) {
			setQuery(initialQuery ?? '');
			setResults([]);
		}
	}, [isOpen, initialQuery]);

	// SWR search on the debounced query: show cached hits immediately, then
	// revalidate in the background. A revalidation that comes back empty while we
	// have cached hits is treated as a transient failure and ignored.
	useEffect(() => {
		if (!isOpen) return;
		const q = debounced.trim();
		if (q.length < 2) {
			setResults([]);
			setLoading(false);
			return;
		}
		const cacheKey = q.toLowerCase();
		const cached = searchCache.get(cacheKey);
		if (cached) setResults(cached); // instant stale render
		setLoading(!cached); // spinner only when there's nothing to show yet

		let cancelled = false;
		moviesService
			.searchMetadata(q)
			.then((r) => {
				if (cancelled) return;
				// Don't let a transient empty (provider hiccup) wipe good cached hits.
				if (r.candidates.length > 0 || !cached) {
					searchCache.set(cacheKey, r.candidates);
					setResults(r.candidates);
				}
			})
			.catch(() => {
				if (!cancelled && !cached) setResults([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [debounced, isOpen]);

	const handleSelect = useCallback(
		async (c: MetadataSearchCandidate) => {
			if (assigningKey != null) return;
			const key = candidateKey(c);
			setAssigningKey(key);
			try {
				await moviesService.assignMetadata(
					movieId,
					c.tmdbId != null ? { tmdbId: c.tmdbId } : { imdbId: c.imdbId ?? undefined },
				);
				notifySuccess(`Metadata set to "${c.title}".`);
				onAssigned?.();
				onClose();
			} catch (err) {
				notifyError((err as Error)?.message || 'Failed to assign metadata.');
			} finally {
				setAssigningKey(null);
			}
		},
		[assigningKey, movieId, onAssigned, onClose],
	);

	const showEmpty = !loading && debounced.trim().length >= 2 && results.length === 0;

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Metadata Search" size="lg">
			<div class={styles.content}>
				{/* biome-ignore lint/a11y/noAutofocus: search box should be focused on open */}
				<input
					type="text"
					class={styles.search}
					placeholder="Search movie titles…"
					value={query}
					onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
					autoFocus
				/>

				{loading && (
					<div class={styles.state}>
						<Spinner size="md" />
					</div>
				)}
				{showEmpty && <div class={styles.state}>No matches found.</div>}

				{results.length > 0 && (
					<ul class={styles.results}>
						{results.map((c) => {
							const key = candidateKey(c);
							return (
								<li class={styles.row} key={key}>
									<div class={styles.poster}>
										<SmartImage
											src={c.posterUrl}
											alt={c.title}
											class={styles.posterImg}
											fallbackLabel={c.title}
											iconOnly
										/>
									</div>
									<div class={styles.info}>
										<div class={styles.title}>
											{c.title}
											{c.year ? (
												<span class={styles.year}> ({c.year})</span>
											) : null}
											<span class={styles.source}>
												{c.provider === 'omdb' ? 'IMDb' : 'TMDB'}
											</span>
										</div>
										{c.overview && <p class={styles.overview}>{c.overview}</p>}
									</div>
									<Button
										variant="primary"
										size="sm"
										disabled={assigningKey != null}
										onClick={() => handleSelect(c)}
									>
										{assigningKey === key ? 'Setting…' : 'Select'}
									</Button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</Modal>
	);
}

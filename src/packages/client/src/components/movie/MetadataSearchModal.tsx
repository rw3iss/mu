import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { SmartImage } from '@/components/common/SmartImage';
import { Spinner } from '@/components/common/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { type MetadataSearchCandidate, moviesService } from '@/services/movies.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './MetadataSearchModal.module.scss';

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
 * "Search for Metadata" — free-text provider search (TMDB) showing candidate
 * movies as rows; selecting one assigns its full metadata to the current movie
 * (the backend applies it via the same merge path as auto-match, caching the
 * provider details so no extra API calls are made on assign).
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
	const [assigningId, setAssigningId] = useState<number | null>(null);

	// Seed the box with the movie title each time the modal opens.
	useEffect(() => {
		if (isOpen) {
			setQuery(initialQuery ?? '');
			setResults([]);
		}
	}, [isOpen, initialQuery]);

	// Search on the debounced query.
	useEffect(() => {
		if (!isOpen) return;
		const q = debounced.trim();
		if (q.length < 2) {
			setResults([]);
			return;
		}
		let cancelled = false;
		setLoading(true);
		moviesService
			.searchMetadata(q)
			.then((r) => {
				if (!cancelled) setResults(r.candidates);
			})
			.catch(() => {
				if (!cancelled) setResults([]);
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
			if (assigningId != null) return;
			setAssigningId(c.tmdbId);
			try {
				await moviesService.assignMetadata(movieId, { tmdbId: c.tmdbId });
				notifySuccess(`Metadata set to "${c.title}".`);
				onAssigned?.();
				onClose();
			} catch (err) {
				notifyError((err as Error)?.message || 'Failed to assign metadata.');
			} finally {
				setAssigningId(null);
			}
		},
		[assigningId, movieId, onAssigned, onClose],
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
						{results.map((c) => (
							<li class={styles.row} key={c.tmdbId}>
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
									</div>
									{c.overview && <p class={styles.overview}>{c.overview}</p>}
								</div>
								<Button
									variant="primary"
									size="sm"
									disabled={assigningId != null}
									onClick={() => handleSelect(c)}
								>
									{assigningId === c.tmdbId ? 'Setting…' : 'Select'}
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>
		</Modal>
	);
}

/**
 * Shared movie selection modal.
 *
 * Used anywhere in the app that needs the user to pick one (or more)
 * movies from their library:
 *   - Discover seed row: "+ Add" → multi-select to seed similarity.
 *   - Future: playlist builders, comparison tools, etc.
 *
 * Modes:
 *   - mode="single"  → at most one selection; confirm enables once
 *     a movie is picked.
 *   - mode="multi"   → any number; confirm enables when ≥1 picked.
 *
 * Reuses the standard Modal chrome (portal, escape key, body
 * scroll-lock) and the project's design tokens — no bespoke colors
 * or sizes that wouldn't track a theme change.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { SmartImage } from '@/components/common/SmartImage';
import { Spinner } from '@/components/common/Spinner';
import { moviesService } from '@/services/movies.service';
import type { Movie } from '@/state/library.state';
import styles from './MoviePicker.module.scss';

export type MoviePickerMode = 'single' | 'multi';

export interface MoviePickerSelection {
	id: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
}

export interface MoviePickerProps {
	isOpen: boolean;
	onClose: () => void;
	mode: MoviePickerMode;
	/**
	 * Called with the user's selection(s) when they confirm. The
	 * picker closes itself after invoking this; the caller doesn't
	 * need to set `isOpen=false` in response.
	 */
	onSelect: (selections: MoviePickerSelection[]) => void;
	title?: string;
	confirmLabel?: string;
	/**
	 * IDs to disable (e.g. movies already in a seed list). They still
	 * appear but can't be re-selected. Useful when the caller wants
	 * to keep them in context without duplicate adds.
	 */
	disabledIds?: string[];
	/** Pre-select these on open (useful for "edit selection" flows). */
	initialSelectedIds?: string[];
}

type SortKey = 'title' | 'year' | 'recent' | 'rating';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
	{ value: 'title', label: 'Title (A–Z)' },
	{ value: 'year', label: 'Year (newest)' },
	{ value: 'recent', label: 'Recently added' },
	{ value: 'rating', label: 'Rating' },
];

const SEARCH_DEBOUNCE_MS = 220;
const PAGE_SIZE = 50;

export function MoviePicker({
	isOpen,
	onClose,
	mode,
	onSelect,
	title = 'Select movies',
	confirmLabel,
	disabledIds,
	initialSelectedIds,
}: MoviePickerProps) {
	const [search, setSearch] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [sort, setSort] = useState<SortKey>('title');
	const [movies, setMovies] = useState<Movie[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<Map<string, MoviePickerSelection>>(new Map());

	const disabledSet = useMemo(() => new Set(disabledIds ?? []), [disabledIds]);

	// Reset selection + search when the modal closes so the next
	// open starts clean. Initial-selected re-applies on open.
	useEffect(() => {
		if (!isOpen) {
			setSearch('');
			setDebouncedSearch('');
			return;
		}
		if (initialSelectedIds && initialSelectedIds.length > 0) {
			// Build a stub map from IDs — real entries get filled in once
			// the movies list loads and we can match by id.
			setSelected(
				new Map(
					initialSelectedIds.map((id) => [
						id,
						{ id, title: id, year: null, posterUrl: null },
					]),
				),
			);
		} else {
			setSelected(new Map());
		}
	}, [isOpen, initialSelectedIds]);

	// Debounce search so we don't flood the API on every keystroke.
	useEffect(() => {
		const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [search]);

	// Fetch when modal opens, sort changes, or search changes.
	useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		setLoading(true);
		setError(null);

		const params: Record<string, string> = {
			page: '1',
			pageSize: String(PAGE_SIZE),
			sort,
		};
		const request = debouncedSearch
			? moviesService.search(debouncedSearch, params)
			: moviesService.list(params);

		request
			.then((res) => {
				if (cancelled) return;
				setMovies(res.movies);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err?.message ?? 'Failed to load movies');
				setMovies([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [isOpen, sort, debouncedSearch]);

	// Hydrate the selected map's stub entries with real title/year/
	// poster once they appear in the loaded movie list. Keeps the
	// selected-summary at the bottom accurate even if the user
	// pre-selected by ID without titles.
	useEffect(() => {
		if (selected.size === 0 || movies.length === 0) return;
		let changed = false;
		const next = new Map(selected);
		for (const m of movies) {
			const existing = next.get(m.id);
			if (existing && existing.title === existing.id) {
				next.set(m.id, {
					id: m.id,
					title: m.title,
					year: m.year ?? null,
					posterUrl: m.posterUrl ?? null,
				});
				changed = true;
			}
		}
		if (changed) setSelected(next);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [movies]);

	const toggle = (m: Movie) => {
		if (disabledSet.has(m.id)) return;
		const next = new Map(selected);
		if (next.has(m.id)) {
			next.delete(m.id);
		} else {
			if (mode === 'single') next.clear();
			next.set(m.id, {
				id: m.id,
				title: m.title,
				year: m.year ?? null,
				posterUrl: m.posterUrl ?? null,
			});
		}
		setSelected(next);
	};

	const clearSelection = () => setSelected(new Map());

	const confirm = () => {
		if (selected.size === 0) return;
		onSelect(Array.from(selected.values()));
		onClose();
	};

	const selectedList = useMemo(() => Array.from(selected.values()), [selected]);
	const selectedSummary = useMemo(() => {
		if (selectedList.length === 0) return null;
		if (mode === 'single') {
			const s = selectedList[0]!;
			return `Selected: ${s.title}${s.year ? ` (${s.year})` : ''}`;
		}
		const names = selectedList.map((s) => s.title).join(', ');
		return `Selected (${selectedList.length}): ${names}`;
	}, [selectedList, mode]);

	const confirmText =
		confirmLabel ??
		(mode === 'single' ? 'Select' : `Select${selected.size > 0 ? ` (${selected.size})` : ''}`);

	return (
		<Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
			<div class={styles.container}>
				<div class={styles.controls}>
					<div class={styles.searchWrap}>
						<Icon name="search" size={14} />
						<input
							type="text"
							class={styles.searchInput}
							placeholder="Search by title…"
							value={search}
							onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
							autoFocus
						/>
						{search && (
							<button
								type="button"
								class={styles.searchClear}
								onClick={() => setSearch('')}
								aria-label="Clear search"
							>
								<Icon name="x" size={12} />
							</button>
						)}
					</div>
					<div class={styles.sortWrap}>
						<Select
							value={sort}
							onChange={(v) => setSort(v as SortKey)}
							options={SORT_OPTIONS}
						/>
					</div>
				</div>

				<div class={styles.listScroll}>
					{loading && movies.length === 0 ? (
						<div class={styles.loading}>
							<Spinner size="md" />
						</div>
					) : error ? (
						<div class={styles.errorState}>{error}</div>
					) : movies.length === 0 ? (
						<div class={styles.emptyState}>
							{debouncedSearch
								? `No movies match "${debouncedSearch}".`
								: 'No movies in your library yet.'}
						</div>
					) : (
						<ul class={styles.list}>
							{movies.map((m) => {
								const isSelected = selected.has(m.id);
								const isDisabled = disabledSet.has(m.id);
								return (
									<li key={m.id}>
										<button
											type="button"
											class={`${styles.row} ${isSelected ? styles.rowSelected : ''} ${
												isDisabled ? styles.rowDisabled : ''
											}`}
											onClick={() => toggle(m)}
											disabled={isDisabled}
											aria-pressed={isSelected}
											title={isDisabled ? 'Already in the list' : undefined}
										>
											<span class={styles.rowCheck} aria-hidden="true">
												{isSelected && <Icon name="check" size={12} />}
											</span>
											<span class={styles.rowPoster}>
												{m.posterUrl ? (
													<SmartImage src={m.posterUrl} alt="" />
												) : (
													<Icon name="film" size={16} />
												)}
											</span>
											<span class={styles.rowMeta}>
												<span class={styles.rowTitle}>{m.title}</span>
												<span class={styles.rowSub}>
													{m.year > 0 ? m.year : '—'}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				{selectedSummary && (
					<div class={styles.selectedSummary} role="status" aria-live="polite">
						<span class={styles.selectedSummaryText}>{selectedSummary}</span>
						<button
							type="button"
							class={styles.clearSelectionBtn}
							onClick={clearSelection}
						>
							Clear
						</button>
					</div>
				)}

				<div class={styles.footer}>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={confirm} disabled={selected.size === 0}>
						{confirmText}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

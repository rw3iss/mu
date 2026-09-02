import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import type { DiscoverFilters as Filters } from '@/services/discover.service';
import styles from './DiscoverFilters.module.scss';

interface DiscoverFiltersProps {
	value: Filters;
	availableGenres: string[];
	onChange: (next: Filters) => void;
	onClear: () => void;
}

/** Decade quick-buttons. End year is exclusive of the next decade so
 * "1990s" means [1990, 1999] not [1990, 2000]. */
const DECADES: ReadonlyArray<{ label: string; from: number; to: number }> = [
	{ label: "'60s", from: 1960, to: 1969 },
	{ label: "'70s", from: 1970, to: 1979 },
	{ label: "'80s", from: 1980, to: 1989 },
	{ label: "'90s", from: 1990, to: 1999 },
	{ label: "'00s", from: 2000, to: 2009 },
	{ label: "'10s", from: 2010, to: 2019 },
	{ label: "'20s", from: 2020, to: 2029 },
];

const WATCHED_OPTIONS: ReadonlyArray<{ value: NonNullable<Filters['watched']>; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'unwatched', label: 'Unwatched' },
	{ value: 'in-progress', label: 'In progress' },
	{ value: 'watched', label: 'Watched' },
];

/**
 * Filter panel for the Discover page. Lives inline (collapsible)
 * rather than as a modal so the user can tweak + re-run quickly.
 * Every field round-trips through the parent's onChange so URL state
 * and the runner stay in sync.
 */
export function DiscoverFilters({
	value,
	availableGenres,
	onChange,
	onClear,
}: DiscoverFiltersProps) {
	const [genreSearch, setGenreSearch] = useState('');
	const selectedGenres = new Set((value.genres ?? []).map((g) => g.toLowerCase()));
	const visibleGenres = genreSearch
		? availableGenres.filter((g) => g.toLowerCase().includes(genreSearch.toLowerCase()))
		: availableGenres;

	const update = (patch: Partial<Filters>) => onChange({ ...value, ...patch });

	const toggleGenre = (genre: string) => {
		const lower = genre.toLowerCase();
		const next = new Set(selectedGenres);
		if (next.has(lower)) next.delete(lower);
		else next.add(lower);
		update({ genres: Array.from(next) });
	};

	const watched = value.watched ?? 'all';

	// Free-text keyword is debounced: every change refetches Discover, which is
	// an expensive call, so committing per keystroke would hammer the server.
	const [keywordDraft, setKeywordDraft] = useState(value.keyword ?? '');
	// Re-sync when the parent resets filters ("Clear all") or restores saved ones.
	useEffect(() => {
		setKeywordDraft(value.keyword ?? '');
	}, [value.keyword]);
	useEffect(() => {
		const next = keywordDraft.trim();
		if (next === (value.keyword ?? '')) return;
		const t = setTimeout(() => update({ keyword: next || undefined }), 400);
		return () => clearTimeout(t);
	}, [keywordDraft]);
	const decadeActive = (d: { from: number; to: number }): boolean =>
		value.yearFrom === d.from && value.yearTo === d.to;

	return (
		<div class={styles.panel}>
			<div class={styles.header}>
				<h3 class={styles.title}>Refine</h3>
				<Button size="sm" variant="ghost" onClick={onClear}>
					Clear all
				</Button>
			</div>

			{/* Rating + votes share a row — both are small numeric minimums. */}
			<div class={styles.section}>
				<div class={styles.minRow}>
					<div class={styles.minField}>
						<label class={styles.fieldLabel} for="discover-min-rating">
							Minimum rating
						</label>
						<input
							id="discover-min-rating"
							type="number"
							class={styles.numInputSm}
							placeholder="0-10"
							min={0}
							max={10}
							step={1}
							value={value.minRating ?? ''}
							onInput={(e) => {
								const raw = (e.target as HTMLInputElement).value;
								const n = raw ? parseInt(raw, 10) : NaN;
								update({
									minRating: Number.isFinite(n) && n > 0 ? n : undefined,
								});
							}}
						/>
					</div>
					<div class={styles.minField}>
						<label class={styles.fieldLabel} for="discover-min-votes">
							Minimum votes
						</label>
						<input
							id="discover-min-votes"
							type="number"
							class={styles.numInputSm}
							placeholder="e.g. 1000"
							min={0}
							step={100}
							value={value.minVotes ?? ''}
							onInput={(e) => {
								const raw = (e.target as HTMLInputElement).value;
								const n = raw ? parseInt(raw, 10) : NaN;
								update({ minVotes: Number.isFinite(n) && n > 0 ? n : undefined });
							}}
						/>
					</div>
				</div>
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>Year</label>
				<div class={styles.yearRow}>
					<input
						type="number"
						class={styles.numInput}
						placeholder="From"
						value={value.yearFrom ?? ''}
						onInput={(e) => {
							const v = (e.target as HTMLInputElement).value;
							update({ yearFrom: v ? parseInt(v, 10) : undefined });
						}}
					/>
					<span class={styles.yearDash}>–</span>
					<input
						type="number"
						class={styles.numInput}
						placeholder="To"
						value={value.yearTo ?? ''}
						onInput={(e) => {
							const v = (e.target as HTMLInputElement).value;
							update({ yearTo: v ? parseInt(v, 10) : undefined });
						}}
					/>
				</div>
				<div class={styles.chipRow}>
					{DECADES.map((d) => (
						<button
							key={d.label}
							type="button"
							class={`${styles.decadeChip} ${decadeActive(d) ? styles.active : ''}`}
							onClick={() => {
								if (decadeActive(d)) {
									update({ yearFrom: undefined, yearTo: undefined });
								} else {
									update({ yearFrom: d.from, yearTo: d.to });
								}
							}}
						>
							{d.label}
						</button>
					))}
				</div>
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>Runtime (minutes)</label>
				<div class={styles.yearRow}>
					<input
						type="number"
						class={styles.numInput}
						placeholder="Min"
						min={0}
						step={5}
						value={value.minRuntime ?? ''}
						onInput={(e) => {
							const raw = (e.target as HTMLInputElement).value;
							const n = raw ? parseInt(raw, 10) : NaN;
							update({ minRuntime: Number.isFinite(n) && n > 0 ? n : undefined });
						}}
					/>
					<span class={styles.yearDash}>–</span>
					<input
						type="number"
						class={styles.numInput}
						placeholder="Max"
						min={0}
						step={5}
						value={value.maxRuntime ?? ''}
						onInput={(e) => {
							const raw = (e.target as HTMLInputElement).value;
							const n = raw ? parseInt(raw, 10) : NaN;
							update({ maxRuntime: Number.isFinite(n) && n > 0 ? n : undefined });
						}}
					/>
				</div>
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>
					Genres
					{selectedGenres.size > 0 && (
						<span class={styles.fieldValue}>{selectedGenres.size} selected</span>
					)}
				</label>
				<input
					class={styles.searchInput}
					type="text"
					placeholder="Filter genres…"
					value={genreSearch}
					onInput={(e) => setGenreSearch((e.target as HTMLInputElement).value)}
				/>
				<div class={styles.genreChips}>
					{visibleGenres.map((g) => {
						const active = selectedGenres.has(g.toLowerCase());
						return (
							<button
								key={g}
								type="button"
								class={`${styles.genreChip} ${active ? styles.active : ''}`}
								onClick={() => toggleGenre(g)}
							>
								{g}
							</button>
						);
					})}
					{visibleGenres.length === 0 && (
						<span class={styles.empty}>No genres match.</span>
					)}
				</div>
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>Cast / director</label>
				<input
					class={styles.searchInput}
					type="text"
					placeholder="e.g. Denis Villeneuve"
					value={value.person ?? ''}
					onInput={(e) =>
						update({ person: (e.target as HTMLInputElement).value || undefined })
					}
				/>
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>Language</label>
				<input
					class={styles.searchInput}
					type="text"
					placeholder="e.g. en, fr, ja"
					value={value.language ?? ''}
					onInput={(e) =>
						update({ language: (e.target as HTMLInputElement).value || undefined })
					}
				/>
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>Watch state</label>
				<div class={styles.chipRow}>
					{WATCHED_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							class={`${styles.decadeChip} ${
								watched === opt.value ? styles.active : ''
							}`}
							onClick={() =>
								update({ watched: opt.value === 'all' ? undefined : opt.value })
							}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{/* Last, because it's the broadest filter: it searches the text the
			    genre chips above can't express ("mob", "heist", "time travel"). */}
			<div class={styles.section}>
				<label class={styles.fieldLabel} for="discover-keyword">
					Keyword
				</label>
				<input
					id="discover-keyword"
					class={styles.searchInput}
					type="text"
					placeholder="e.g. mob, mafia"
					value={keywordDraft}
					onInput={(e) => setKeywordDraft((e.target as HTMLInputElement).value)}
					title="Searches each movie's summary, TMDB keywords, title and genres. Separate terms with commas to match any of them."
				/>
				<span class={styles.fieldHint}>
					Searches summaries and keywords. Commas match any term.
				</span>
			</div>
		</div>
	);
}

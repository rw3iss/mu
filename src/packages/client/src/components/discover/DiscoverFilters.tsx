import { useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import type { DiscoverFilters as Filters } from '@/services/discover.service';
import styles from './DiscoverFilters.module.scss';

interface DiscoverFiltersProps {
	value: Filters;
	availableGenres: string[];
	onChange: (next: Filters) => void;
	onClear: () => void;
}

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

	return (
		<div class={styles.panel}>
			<div class={styles.header}>
				<h3 class={styles.title}>Refine</h3>
				<Button size="sm" variant="ghost" onClick={onClear}>
					Clear all
				</Button>
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>
					Minimum rating
					<span class={styles.fieldValue}>{value.minRating ?? 0}</span>
				</label>
				<input
					type="range"
					min={0}
					max={10}
					step={0.1}
					value={value.minRating ?? 0}
					onInput={(e) => {
						const v = parseFloat((e.target as HTMLInputElement).value);
						update({ minRating: v > 0 ? v : undefined });
					}}
				/>
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
			</div>

			<div class={styles.section}>
				<label class={styles.fieldLabel}>Genres</label>
				<input
					class={styles.searchInput}
					type="text"
					placeholder="Filter genres…"
					value={genreSearch}
					onInput={(e) => setGenreSearch((e.target as HTMLInputElement).value)}
				/>
				<div class={styles.genreChips}>
					{visibleGenres.slice(0, 40).map((g) => {
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
		</div>
	);
}

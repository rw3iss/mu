import { Select } from '@/components/common/Select';
import type { LibraryFilter, ResultFilterState, ResultSort } from '@/utils/result-filters';
import styles from './ResultFilterBar.module.scss';

interface ResultFilterBarProps {
	value: ResultFilterState;
	onChange: (next: ResultFilterState) => void;
	/** Number of rows currently passing the filters, shown as "N titles found." */
	count: number;
	/** Extra controls (e.g. a Type dropdown) rendered before the count. */
	children?: preact.ComponentChildren;
}

/**
 * Sort + filter controls shared by the person page's "Known For" rail and the
 * movie page's "Similar" section: sort, in-library, and minimum year / rating /
 * votes, followed by a live result count.
 */
export function ResultFilterBar({ value, onChange, count, children }: ResultFilterBarProps) {
	const set = (patch: Partial<ResultFilterState>) => onChange({ ...value, ...patch });

	return (
		<div class={styles.controls}>
			<span class={styles.group}>
				<span class={styles.label}>Sort</span>
				<Select
					value={value.sort}
					onChange={(v) => set({ sort: v as ResultSort })}
					options={[
						{ value: 'year', label: 'Year' },
						{ value: 'title', label: 'Title' },
						{ value: 'rating', label: 'Rating' },
						{ value: 'votes', label: 'Votes' },
					]}
					aria-label="Sort results by"
				/>
			</span>

			<span class={styles.group}>
				<span class={styles.label}>In Library?</span>
				<Select
					value={value.library}
					onChange={(v) => set({ library: v as LibraryFilter })}
					options={[
						{ value: 'all', label: 'All' },
						{ value: 'in', label: 'In Library' },
						{ value: 'out', label: 'Not in Library' },
					]}
					aria-label="Filter results by library status"
				/>
			</span>

			{children}

			<input
				type="number"
				class={styles.yearInput}
				min="1870"
				max="2100"
				step="1"
				placeholder="Min year"
				aria-label="Minimum year"
				value={value.minYear}
				onInput={(e) => set({ minYear: (e.target as HTMLInputElement).value })}
			/>
			<input
				type="number"
				class={styles.ratingInput}
				min="0"
				max="10"
				step="0.1"
				placeholder="Min ★"
				aria-label="Minimum rating"
				value={value.minRating}
				onInput={(e) => set({ minRating: (e.target as HTMLInputElement).value })}
			/>
			<input
				type="number"
				class={styles.votesInput}
				min="0"
				step="100"
				placeholder="Min votes"
				aria-label="Minimum votes"
				value={value.minVotes}
				onInput={(e) => set({ minVotes: (e.target as HTMLInputElement).value })}
			/>

			<span class={styles.count}>
				{count} {count === 1 ? 'title' : 'titles'} found.
			</span>
		</div>
	);
}

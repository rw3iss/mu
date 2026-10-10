import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import type { LibraryFilter, ResultFilterState, ResultSort } from '@/utils/result-filters';
import styles from './ResultFilterBar.module.scss';

/**
 * Declarative filter control. Lets non-movie surfaces (music library) reuse
 * the bar without the movie-specific sort/library/min-votes fields.
 */
export type FilterField =
	| {
			kind: 'select';
			key: string;
			label?: string;
			options: { value: string; label: string }[];
	  }
	| {
			kind: 'number';
			key: string;
			label?: string;
			placeholder?: string;
			min?: number;
			max?: number;
			step?: number;
			/** CSS width (default 96px). */
			width?: string;
	  }
	| {
			kind: 'text';
			key: string;
			label?: string;
			placeholder?: string;
			width?: string;
	  };

export type FilterValues = Record<string, string>;

interface SchemaFilterBarProps {
	fields: FilterField[];
	values: FilterValues;
	onChange: (next: FilterValues) => void;
	/** Optional live result count. */
	count?: number;
	/** Noun for the count (default "result"/"results"). */
	countNoun?: [singular: string, plural: string];
	children?: preact.ComponentChildren;
}

/** Schema-driven variant of the filter bar. */
export function SchemaFilterBar({
	fields,
	values,
	onChange,
	count,
	countNoun = ['result', 'results'],
	children,
}: SchemaFilterBarProps) {
	const set = (key: string, v: string) => onChange({ ...values, [key]: v });
	return (
		<div class={styles.controls}>
			{fields.map((f) => {
				if (f.kind === 'select') {
					return (
						<span key={f.key} class={styles.group}>
							{f.label && <span class={styles.label}>{f.label}</span>}
							<Select
								value={values[f.key] ?? ''}
								onChange={(v) => set(f.key, v)}
								options={f.options}
								aria-label={f.label ?? f.key}
							/>
						</span>
					);
				}
				return (
					<span key={f.key} class={styles.group}>
						{f.label && <span class={styles.label}>{f.label}</span>}
						<input
							type={f.kind === 'number' ? 'number' : 'text'}
							style={{ width: f.width ?? '96px' }}
							min={f.kind === 'number' && f.min != null ? String(f.min) : undefined}
							max={f.kind === 'number' && f.max != null ? String(f.max) : undefined}
							step={
								f.kind === 'number' && f.step != null ? String(f.step) : undefined
							}
							placeholder={f.placeholder}
							aria-label={f.label ?? f.placeholder ?? f.key}
							value={values[f.key] ?? ''}
							onInput={(e) => set(f.key, (e.target as HTMLInputElement).value)}
						/>
					</span>
				);
			})}
			{children}
			{count != null && (
				<span class={styles.count}>
					{count} {count === 1 ? countNoun[0] : countNoun[1]}
				</span>
			)}
		</div>
	);
}

interface ResultFilterBarProps {
	value: ResultFilterState;
	onChange: (next: ResultFilterState) => void;
	/** Number of rows currently passing the filters, shown as "N titles found." */
	count: number;
	/** Extra controls (e.g. a Type dropdown) rendered before the count. */
	children?: preact.ComponentChildren;
	/**
	 * Persist the current filters as the user's defaults. When omitted the
	 * save button is hidden, so the bar stays usable in contexts with no user
	 * (e.g. a share link).
	 */
	onSaveDefaults?: () => Promise<void>;
	/**
	 * Controls the host page already provides elsewhere. Discover has its own
	 * Refine sidebar (server-side year/rating/votes) and an Include toggle for
	 * library state, so it hides all but the sort to avoid two competing copies
	 * of the same filter.
	 */
	hide?: ReadonlyArray<'sort' | 'library' | 'minYear' | 'minRating' | 'minVotes'>;
}

/**
 * Sort + filter controls shared by the person page's "Known For" rail and the
 * movie page's "Similar" section: sort, in-library, and minimum year / rating /
 * votes, followed by a live result count.
 */
/**
 * Pass `fields` (a FilterField[] schema) for the generic variant; otherwise the
 * classic movie sort / library / min-year / rating / votes controls render.
 */
export function ResultFilterBar(props: ResultFilterBarProps | SchemaFilterBarProps) {
	if ('fields' in props) return <SchemaFilterBar {...props} />;
	return <MovieResultFilterBar {...props} />;
}

function MovieResultFilterBar({
	value,
	onChange,
	count,
	children,
	onSaveDefaults,
	hide,
}: ResultFilterBarProps) {
	const set = (patch: Partial<ResultFilterState>) => onChange({ ...value, ...patch });
	const shows = (k: NonNullable<ResultFilterBarProps['hide']>[number]) => !hide?.includes(k);
	const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
	// Held so unmounting mid-timeout can't setState on a dead component.
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => resetTimer.current && clearTimeout(resetTimer.current), []);

	const handleSave = async () => {
		if (!onSaveDefaults || saveState === 'saving') return;
		setSaveState('saving');
		try {
			await onSaveDefaults();
			setSaveState('saved');
		} catch {
			setSaveState('error');
		}
		if (resetTimer.current) clearTimeout(resetTimer.current);
		resetTimer.current = setTimeout(() => setSaveState('idle'), 2200);
	};

	return (
		<div class={styles.controls}>
			{shows('sort') && (
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
			)}

			{shows('library') && (
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
			)}

			{children}

			{shows('minYear') && (
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
			)}
			{shows('minRating') && (
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
			)}
			{shows('minVotes') && (
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
			)}

			<span class={styles.count}>
				{count} {count === 1 ? 'title' : 'titles'} found.
			</span>

			{onSaveDefaults && (
				<span class={styles.saveWrap}>
					<button
						type="button"
						class={`${styles.saveBtn} ${
							saveState === 'saved' ? styles.saveBtnDone : ''
						} ${saveState === 'error' ? styles.saveBtnError : ''}`}
						onClick={handleSave}
						disabled={saveState === 'saving'}
						aria-label="Save search as default"
						title={
							'Save search as default — the sort and filters above become ' +
							'your defaults for every Known For and Similar list. Replaces ' +
							'any previously saved values.'
						}
					>
						<Icon
							name={saveState === 'saved' ? 'check' : 'save'}
							size={14}
							aria-hidden="true"
						/>
					</button>
					{/* Transient confirmation, announced for screen readers too. */}
					{saveState !== 'idle' && saveState !== 'saving' && (
						<span
							class={`${styles.saveToast} ${
								saveState === 'error' ? styles.saveToastError : ''
							}`}
							role="status"
						>
							{saveState === 'saved' ? 'Saved as default' : 'Could not save'}
						</span>
					)}
				</span>
			)}
		</div>
	);
}

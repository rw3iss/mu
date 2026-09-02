import type { MovieSearchHit, PersonSearchHit, SearchHit, SearchSource } from '@mu/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { usePopover } from '@/hooks/usePopover';
import styles from './EntitySearchInput.module.scss';
import { useSearchStream } from './useSearchStream.js';

export interface EntitySearchInputProps {
	type: 'movie' | 'person';
	placeholder?: string;
	onSelect: (hit: SearchHit) => void;
	onView?: (hit: SearchHit) => void;
	disabledKeys?: string[];
	autoFocus?: boolean;
	maxHeight?: number;
	class?: string;
}

function defaultOnView(hit: SearchHit) {
	if ('personKey' in hit) {
		route(`/person/${hit.personKey}`);
		return;
	}
	if (hit.movieId) {
		route(`/movie/${hit.movieId}`);
		return;
	}
	if (hit.tmdbId) {
		route(`/movie/tmdb:${hit.tmdbId}`);
	}
}

function formatVotes(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
	return String(n);
}

function movieSubtitle(hit: MovieSearchHit): string {
	const parts: string[] = [];
	if (hit.year) parts.push(String(hit.year));
	const rating = hit.imdbRating ?? hit.tmdbRating;
	if (rating != null) {
		const votes = hit.imdbRating != null ? hit.imdbVotes : hit.tmdbVotes;
		const votesStr = votes != null && votes > 0 ? ` (${formatVotes(votes)})` : '';
		parts.push(`★ ${rating.toFixed(1)}${votesStr}`);
	}
	return parts.join(' · ');
}

function hitKey(hit: SearchHit): string {
	if ('personKey' in hit) return hit.personKey;
	const m = hit as MovieSearchHit;
	if (m.movieId) return m.movieId;
	if (m.tmdbId) return `tmdb:${m.tmdbId}`;
	if (m.imdbId) return `imdb:${m.imdbId}`;
	return `${m.title}|${m.year ?? ''}`;
}

const SOURCE_COLOR: Record<SearchSource, string> = {
	local: '#4ade80',
	cache: '#94a3b8',
	tmdb: '#3b82f6',
	omdb: '#f59e0b',
	trakt: '#ef4444',
};

export function EntitySearchInput({
	type,
	placeholder,
	onSelect,
	onView = defaultOnView,
	disabledKeys,
	autoFocus,
	maxHeight = 360,
	class: className,
}: EntitySearchInputProps) {
	const [raw, setRaw] = useState('');
	const [debounced, setDebounced] = useState('');
	const [open, setOpen] = useState(false);
	const [activeIdx, setActiveIdx] = useState(-1);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(raw), 250);
		return () => clearTimeout(t);
	}, [raw]);

	const { results, isLoading, error } = useSearchStream(type, debounced);

	const handleClose = useCallback(() => setOpen(false), []);
	usePopover({ ref: wrapRef, open, onClose: handleClose });

	const disabledSet = new Set(disabledKeys ?? []);
	const visible = (results as SearchHit[]).filter((h) => !disabledSet.has(hitKey(h)));

	const onKeyDown = (e: KeyboardEvent) => {
		if (!open) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActiveIdx((i) => Math.min(i + 1, visible.length - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActiveIdx((i) => Math.max(i - 1, 0));
		} else if (e.key === 'Enter') {
			if (activeIdx >= 0 && visible[activeIdx]) {
				e.preventDefault();
				pick(visible[activeIdx]);
			}
		} else if (e.key === 'Escape') {
			setOpen(false);
		}
	};

	const pick = (hit: SearchHit) => {
		onSelect(hit);
		setRaw('');
		setDebounced('');
		setOpen(false);
		setActiveIdx(-1);
	};

	return (
		<div class={`${styles.wrap} ${className ?? ''}`} ref={wrapRef}>
			<input
				class={styles.input}
				role="combobox"
				aria-expanded={open}
				autoFocus={autoFocus}
				placeholder={placeholder}
				value={raw}
				onInput={(e) => {
					setRaw((e.target as HTMLInputElement).value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				onKeyDown={onKeyDown as any}
			/>
			{isLoading && <span class={styles.spinner} aria-hidden="true" />}
			{open && debounced.length >= 2 && (
				<ul class={styles.dropdown} style={{ maxHeight }} role="listbox">
					{visible.length === 0 && !isLoading && (
						<li class={styles.empty}>No results.</li>
					)}
					{visible.map((hit, i) => {
						const isPerson = 'personKey' in hit;
						const label = isPerson
							? (hit as PersonSearchHit).name
							: (hit as MovieSearchHit).title;
						const sub = isPerson
							? ((hit as PersonSearchHit).role ??
								(hit as PersonSearchHit).knownFor?.slice(0, 3).join(', ') ??
								'')
							: movieSubtitle(hit as MovieSearchHit);
						const img = isPerson
							? (hit as PersonSearchHit).profileUrl
							: (hit as MovieSearchHit).posterUrl;
						return (
							<li
								key={hitKey(hit)}
								class={`${styles.row} ${i === activeIdx ? styles.active : ''} ${hit.isOwned ? styles.owned : ''}`}
								role="option"
								aria-selected={i === activeIdx}
								onMouseEnter={() => setActiveIdx(i)}
								onClick={() => pick(hit)}
							>
								{img ? (
									<img class={styles.thumb} src={img} alt="" loading="lazy" />
								) : (
									<div class={`${styles.thumb} ${styles.thumbEmpty}`} />
								)}
								<div class={styles.text}>
									<div class={styles.title}>{label}</div>
									<div class={styles.sub}>{sub}</div>
								</div>
								<div
									class={styles.sourceDots}
									aria-label={`Sources: ${hit.sources.join(', ')}`}
								>
									{hit.sources.map((s) => (
										<span
											key={s}
											class={styles.dot}
											style={{ background: SOURCE_COLOR[s] }}
											title={s}
										/>
									))}
								</div>
								<button
									type="button"
									class={styles.viewBtn}
									onClick={(e) => {
										e.stopPropagation();
										onView(hit);
									}}
									title="View details"
								>
									View
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{error && <div class={styles.errorMsg}>{error}</div>}
		</div>
	);
}

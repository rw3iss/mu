import type { MusicSearchHit } from '@mu/shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { currentPath, currentUrl } from '@/app';
import { useSearchStream } from '@/components/common/EntitySearchInput/useSearchStream';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { useDebounce } from '@/hooks/useDebounce';
import { musicHitHref, musicHitKey } from '@/utils/music-links';
import styles from './MusicSearch.module.scss';
import topStyles from './TopBar.module.scss';

interface FlatItem {
	kind: 'artist' | 'album' | 'track';
	key: string;
	title: string;
	subtitle: string;
	art: string | null;
	href: string;
	owned: boolean;
}

const LIBRARY = '/music/library';
const GROUP_LIMIT: Record<FlatItem['kind'], number> = { artist: 5, album: 6, track: 8 };
const KIND_ORDER: FlatItem['kind'][] = ['artist', 'album', 'track'];

function subtitleOf(h: MusicSearchHit): string {
	if (h.kind === 'artist') return h.detail ?? 'Artist';
	if (h.kind === 'album') return [h.artist, h.year].filter(Boolean).join(' · ');
	return [h.artist, h.album].filter(Boolean).join(' · ');
}

/** Group streamed hits: artists → albums → tracks; library first, then match score. */
function flatten(hits: MusicSearchHit[]): FlatItem[] {
	const out: FlatItem[] = [];
	for (const kind of KIND_ORDER) {
		const group = hits
			.filter((h) => h.kind === kind)
			.map((h) => ({ h, href: musicHitHref(h) }))
			.filter((x): x is { h: MusicSearchHit; href: string } => !!x.href)
			.sort(
				(a, b) =>
					Number(b.h.isOwned) - Number(a.h.isOwned) || b.h.matchScore - a.h.matchScore,
			)
			.slice(0, GROUP_LIMIT[kind]);
		for (const { h, href } of group) {
			out.push({
				kind,
				key: musicHitKey(h),
				title: h.title,
				subtitle: subtitleOf(h),
				art: h.artUrl ?? null,
				href,
				owned: h.isOwned,
			});
		}
	}
	return out;
}

const GROUP_LABEL: Record<FlatItem['kind'], string> = {
	artist: 'Artists',
	album: 'Albums',
	track: 'Tracks',
};

/** Navigate the library to `q`, keeping the active tab / filters when already there. */
function goToLibrary(q: string) {
	const onLib = currentPath.value === LIBRARY;
	const params = new URLSearchParams(onLib ? window.location.search : '');
	if (q) params.set('q', q);
	else params.delete('q');
	const qs = params.toString();
	route(qs ? `${LIBRARY}?${qs}` : LIBRARY, onLib);
}

/**
 * Header search in music mode: debounced grouped dropdown (artists / albums /
 * tracks) streamed from the federated `/search/music/stream` (library first,
 * then MusicBrainz → `mb:` stub pages), keyboard navigable; Enter without a
 * highlighted row searches the music library (`/music/library?q=`).
 */
export function MusicSearch() {
	const [value, setValue] = useState('');
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	const inputRef = useRef<HTMLInputElement>(null);
	const wrapRef = useRef<HTMLFormElement>(null);
	const debounced = useDebounce(value.trim(), 250);
	const { results, isLoading: loading } = useSearchStream('music', debounced);
	const items = useMemo(() => flatten(results), [results]);
	const searched = debounced.length >= 2;

	// Mirror ?q= from the library URL when not typing (back/forward, deep links).
	useEffect(() => {
		if (currentPath.value !== LIBRARY) return;
		if (document.activeElement === inputRef.current) return;
		const q = new URLSearchParams(window.location.search).get('q') || '';
		setValue(q);
	}, [currentUrl.value]);

	// Reset the highlight when the query changes (not on every streamed batch).
	useEffect(() => setActive(-1), [debounced]);

	// Close on outside click.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [open]);

	const pick = (item: FlatItem) => {
		setOpen(false);
		inputRef.current?.blur();
		route(item.href);
	};

	const submit = (e: Event) => {
		e.preventDefault();
		const item = active >= 0 ? items[active] : undefined;
		if (item) {
			pick(item);
			return;
		}
		setOpen(false);
		inputRef.current?.blur();
		goToLibrary(value.trim());
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setOpen(true);
			setActive((i) => (items.length ? (i + 1) % items.length : -1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (open) setOpen(false);
			else inputRef.current?.blur();
		}
	};

	const clear = () => {
		setValue('');
		if (currentPath.value === LIBRARY) goToLibrary('');
		inputRef.current?.focus();
	};

	const showDropdown = open && value.trim().length > 0;
	const listId = 'music-search-results';

	return (
		<form class={`${topStyles.searchForm} ${styles.wrap}`} onSubmit={submit} ref={wrapRef}>
			<input
				ref={inputRef}
				type="text"
				class={topStyles.searchInput}
				placeholder="Search music..."
				value={value}
				onInput={(e) => {
					setValue((e.target as HTMLInputElement).value);
					setOpen(true);
				}}
				onFocus={(e) => {
					(e.target as HTMLInputElement).select();
					setOpen(true);
				}}
				onKeyDown={onKeyDown}
				aria-label="Search music"
				role="combobox"
				aria-expanded={showDropdown}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
			/>
			{value && (
				<button
					type="button"
					class={topStyles.searchClear}
					onClick={clear}
					aria-label="Clear search"
					title="Clear search"
				>
					<Icon name="x" size={14} />
				</button>
			)}
			{showDropdown && (
				<div class={styles.dropdown} id={listId} role="listbox">
					{!searched && <div class={styles.empty}>Type at least 2 characters</div>}
					{searched && loading && items.length === 0 && (
						<div class={styles.empty}>Searching…</div>
					)}
					{searched && !loading && items.length === 0 && (
						<div class={styles.empty}>No matches for “{value.trim()}”</div>
					)}
					{items.map((item, i) => {
						const header = i === 0 || items[i - 1]!.kind !== item.kind;
						return (
							<div key={item.key}>
								{header && <div class={styles.group}>{GROUP_LABEL[item.kind]}</div>}
								<div
									id={`${listId}-${i}`}
									role="option"
									aria-selected={i === active}
									class={`${styles.item} ${i === active ? styles.itemActive : ''}`}
									onMouseEnter={() => setActive(i)}
									onMouseDown={(e: MouseEvent) => {
										e.preventDefault();
										pick(item);
									}}
								>
									<SmartImage
										src={item.art}
										alt=""
										iconOnly
										class={`${styles.thumb} ${item.kind === 'artist' ? styles.thumbRound : ''}`}
									/>
									<span class={styles.text}>
										<span class={styles.title}>{item.title}</span>
										{item.subtitle && (
											<span class={styles.subtitle}>{item.subtitle}</span>
										)}
									</span>
									{!item.owned && (
										<span class={styles.badge} title="Not in your library">
											MusicBrainz
										</span>
									)}
								</div>
							</div>
						);
					})}
					{searched && loading && items.length > 0 && (
						<div class={styles.more}>Searching more sources…</div>
					)}
					{items.length > 0 && (
						<button
							type="button"
							class={styles.seeAll}
							onMouseDown={(e: MouseEvent) => {
								e.preventDefault();
								setOpen(false);
								goToLibrary(value.trim());
							}}
						>
							See all results in Library
						</button>
					)}
				</div>
			)}
		</form>
	);
}

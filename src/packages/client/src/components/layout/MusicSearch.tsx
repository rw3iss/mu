import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { currentPath, currentUrl } from '@/app';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { useDebounce } from '@/hooks/useDebounce';
import { type MusicSearchResult, musicService } from '@/services/music.service';
import styles from './MusicSearch.module.scss';
import topStyles from './TopBar.module.scss';

interface FlatItem {
	kind: 'artist' | 'album' | 'track';
	id: string;
	title: string;
	subtitle: string;
	art: string | null;
	href: string;
}

const LIBRARY = '/music/library';

function flatten(r: MusicSearchResult | null): FlatItem[] {
	if (!r) return [];
	return [
		...r.artists.slice(0, 5).map<FlatItem>((a) => ({
			kind: 'artist',
			id: a.id,
			title: a.name,
			subtitle: a.albumCount != null ? `${a.albumCount} albums` : 'Artist',
			art: a.imageUrl,
			href: `/artist/${a.id}`,
		})),
		...r.albums.slice(0, 6).map<FlatItem>((a) => ({
			kind: 'album',
			id: a.id,
			title: a.title,
			subtitle: [a.artistCredit, a.year].filter(Boolean).join(' · '),
			art: a.artUrl,
			href: `/album/${a.id}`,
		})),
		...r.tracks.slice(0, 8).map<FlatItem>((t) => ({
			kind: 'track',
			id: t.id,
			title: t.title,
			subtitle: [t.artistCredit, t.albumTitle].filter(Boolean).join(' · '),
			art: t.artUrl,
			href: `/track/${t.id}`,
		})),
	];
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
 * tracks) from `musicService.search`, keyboard navigable; Enter without a
 * highlighted row searches the music library (`/music/library?q=`).
 */
export function MusicSearch() {
	const [value, setValue] = useState('');
	const [results, setResults] = useState<MusicSearchResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	const inputRef = useRef<HTMLInputElement>(null);
	const wrapRef = useRef<HTMLFormElement>(null);
	const debounced = useDebounce(value.trim(), 200);
	const items = useMemo(() => flatten(results), [results]);

	// Mirror ?q= from the library URL when not typing (back/forward, deep links).
	useEffect(() => {
		if (currentPath.value !== LIBRARY) return;
		if (document.activeElement === inputRef.current) return;
		const q = new URLSearchParams(window.location.search).get('q') || '';
		setValue(q);
	}, [currentUrl.value]);

	useEffect(() => {
		if (!debounced) {
			setResults(null);
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		musicService
			.search(debounced)
			.then((r) => {
				if (!cancelled) {
					setResults(r);
					setActive(-1);
				}
			})
			.catch(() => !cancelled && setResults({ artists: [], albums: [], tracks: [] }))
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [debounced]);

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
		setResults(null);
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
					{loading && items.length === 0 && <div class={styles.empty}>Searching…</div>}
					{!loading && results && items.length === 0 && (
						<div class={styles.empty}>No matches for “{value.trim()}”</div>
					)}
					{items.map((item, i) => {
						const header = i === 0 || items[i - 1]!.kind !== item.kind;
						return (
							<div key={`${item.kind}:${item.id}`}>
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
								</div>
							</div>
						);
					})}
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

import type { AlbumSummary, ArtistSummary, TrackSummary } from '@mu/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { currentUrl } from '@/app';
import { EmptyState } from '@/components/common/EmptyState';
import { EntityOptionsMenu } from '@/components/common/EntityOptionsMenu';
import { Icon } from '@/components/common/Icon';
import { MediaRow } from '@/components/common/MediaRow';
import { type FilterField, SchemaFilterBar } from '@/components/common/ResultFilterBar';
import { Tabs } from '@/components/common/Tabs';
import { RatingWidget } from '@/components/movie/RatingWidget';
import { ArtistLinks, InlineLink } from '@/components/music/InlineLink';
import { AlbumCard, ArtistCard, CardGrid } from '@/components/music/MusicCards';
import { MusicUploadButton } from '@/components/music/MusicUploadModal';
import { useUiSetting } from '@/hooks/useUiSetting';
import { entitiesService } from '@/services/entities.service';
import { type MusicListQuery, musicService, type Page } from '@/services/music.service';
import { musicChange } from '@/state/musicLibraryEvents.state';
import { notifyError } from '@/state/notifications.state';
import {
	albumQueueItem,
	formatDuration,
	formatTotalLength,
	playTracksFrom,
	trackQueueItem,
} from '@/utils/music';
import styles from './MusicLibrary.module.scss';

interface MusicLibraryProps {
	path?: string;
}

type Tab = 'artists' | 'albums' | 'tracks' | 'genres';
const TABS: readonly Tab[] = ['artists', 'albums', 'tracks', 'genres'];
type Order = 'asc' | 'desc';

/** All library state lives in the URL query so refresh / Back restore it. */
interface LibraryParams {
	tab: Tab;
	q: string;
	sort: string;
	order: Order | '';
	genre: string;
	yearFrom: string;
	yearTo: string;
	minRating: string;
}

const DEFAULT_SORT: Record<Tab, string> = {
	artists: 'name',
	albums: 'added',
	tracks: 'title',
	genres: '',
};

/** Natural direction per sort key when the URL doesn't pin one. */
function defaultOrder(sort: string): Order {
	return ['added', 'year', 'rating', 'albums', 'duration'].includes(sort) ? 'desc' : 'asc';
}

function readParams(url: string): LibraryParams {
	const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
	const p = new URLSearchParams(qs);
	const tab = p.get('tab');
	const order = p.get('order');
	return {
		tab: TABS.includes(tab as Tab) ? (tab as Tab) : 'albums',
		q: p.get('q') ?? '',
		sort: p.get('sort') ?? '',
		order: order === 'asc' || order === 'desc' ? order : '',
		genre: p.get('genre') ?? '',
		yearFrom: p.get('yearFrom') ?? '',
		yearTo: p.get('yearTo') ?? '',
		minRating: p.get('minRating') ?? '',
	};
}

function writeParams(next: LibraryParams): void {
	const q = new URLSearchParams();
	if (next.tab !== 'albums') q.set('tab', next.tab);
	if (next.q) q.set('q', next.q);
	if (next.sort) q.set('sort', next.sort);
	if (next.order) q.set('order', next.order);
	if (next.genre) q.set('genre', next.genre);
	if (next.yearFrom) q.set('yearFrom', next.yearFrom);
	if (next.yearTo) q.set('yearTo', next.yearTo);
	if (next.minRating) q.set('minRating', next.minRating);
	const s = q.toString();
	const target = s ? `/music/library?${s}` : '/music/library';
	if (target !== window.location.pathname + window.location.search) route(target, true);
}

function num(s: string): number | undefined {
	const n = Number(s);
	return s !== '' && Number.isFinite(n) ? n : undefined;
}

function toQuery(p: LibraryParams): MusicListQuery {
	const sort = p.sort || DEFAULT_SORT[p.tab];
	return {
		q: p.q || undefined,
		sort,
		order: p.order || defaultOrder(sort),
		genre: p.tab === 'albums' ? p.genre || undefined : undefined,
		yearFrom: p.tab === 'albums' ? num(p.yearFrom) : undefined,
		yearTo: p.tab === 'albums' ? num(p.yearTo) : undefined,
		minRating: p.tab === 'albums' ? num(p.minRating) : undefined,
	};
}

// ============================================
// Paged list loader
// ============================================

interface PagedList<T> {
	items: T[];
	total: number | null;
	loading: boolean;
	error: string | null;
	loadMore: () => void;
}

/**
 * Accumulating pager over a `Page<T>` endpoint. Resets when `key` changes;
 * the first page is debounced so typing in filter inputs doesn't spam requests.
 */
function usePagedList<T>(
	fetchPage: (page: number, pageSize: number) => Promise<Page<T>>,
	key: string,
	pageSize: number,
	enabled = true,
): PagedList<T> {
	const [items, setItems] = useState<T[]>([]);
	const [total, setTotal] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const gen = useRef(0);
	const pageRef = useRef(0);
	const busy = useRef(false);
	const fetchRef = useRef(fetchPage);
	fetchRef.current = fetchPage;

	const load = useCallback(
		async (page: number, myGen: number) => {
			busy.current = true;
			setLoading(true);
			try {
				const res = await fetchRef.current(page, pageSize);
				if (myGen !== gen.current) return;
				pageRef.current = page;
				setTotal(res.total);
				setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items]));
				setError(null);
			} catch (err) {
				if (myGen === gen.current) setError((err as Error)?.message || 'Failed to load');
			} finally {
				if (myGen === gen.current) {
					busy.current = false;
					setLoading(false);
				}
			}
		},
		[pageSize],
	);

	useEffect(() => {
		if (!enabled) return;
		const myGen = ++gen.current;
		busy.current = true;
		setLoading(true);
		setItems([]);
		setTotal(null);
		pageRef.current = 0;
		const t = setTimeout(() => void load(1, myGen), 200);
		return () => clearTimeout(t);
	}, [key, enabled]);

	// Server says the catalogue changed: reload page 1 in place (no blank flash).
	const version = musicChange.value.version;
	useEffect(() => {
		if (!enabled || version === 0) return;
		void load(1, ++gen.current);
	}, [version]);

	const loadMore = useCallback(() => {
		if (busy.current) return;
		if (total !== null && items.length >= total) return;
		void load(pageRef.current + 1, gen.current);
	}, [total, items.length, load]);

	return { items, total, loading, error, loadMore };
}

/** Calls `onVisible` whenever it scrolls into view (infinite scroll trigger). */
function Sentinel({ onVisible }: { onVisible: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const cb = useRef(onVisible);
	cb.current = onVisible;
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) cb.current();
			},
			{ rootMargin: '600px 0px' },
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);
	return <div ref={ref} class={styles.sentinel} aria-hidden="true" />;
}

// ============================================
// Page
// ============================================

export function MusicLibrary(_props: MusicLibraryProps) {
	const params = readParams(currentUrl.value);
	const set = (patch: Partial<LibraryParams>) => writeParams({ ...params, ...patch });

	const switchTab = (id: string) =>
		writeParams({
			tab: id as Tab,
			q: params.q,
			sort: '',
			order: '',
			genre: '',
			yearFrom: '',
			yearTo: '',
			minRating: '',
		});

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<h1 class={styles.title}>Music Library</h1>
				<MusicUploadButton />
				{params.q && (
					<span class={styles.queryChip}>
						Results for “{params.q}”
						<button
							type="button"
							class={styles.queryClear}
							onClick={() => set({ q: '' })}
							aria-label="Clear search"
							title="Clear search"
						>
							<Icon name="x" size={12} />
						</button>
					</span>
				)}
			</header>

			<Tabs
				class={styles.tabs}
				activeTab={params.tab}
				onTabChange={switchTab}
				tabs={[
					{ id: 'artists', label: 'Artists' },
					{ id: 'albums', label: 'Albums' },
					{ id: 'tracks', label: 'Tracks' },
					{ id: 'genres', label: 'Genres' },
				]}
			/>

			{params.tab === 'artists' && <ArtistsTab params={params} set={set} />}
			{params.tab === 'albums' && <AlbumsTab params={params} set={set} />}
			{params.tab === 'tracks' && <TracksTab params={params} set={set} />}
			{params.tab === 'genres' && <GenresTab q={params.q} />}
		</div>
	);
}

interface TabProps {
	params: LibraryParams;
	set: (patch: Partial<LibraryParams>) => void;
}

function OrderToggle({ order, onToggle }: { order: Order; onToggle: () => void }) {
	return (
		<button
			type="button"
			class={styles.iconBtn}
			onClick={onToggle}
			title={order === 'asc' ? 'Ascending' : 'Descending'}
			aria-label={`Sort ${order === 'asc' ? 'ascending' : 'descending'}; click to flip`}
		>
			<Icon name={order === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} />
		</button>
	);
}

function ListStatus({
	list,
	empty,
}: {
	list: PagedList<unknown>;
	empty: { title: string; message?: string };
}) {
	if (list.error && list.items.length === 0) {
		return (
			<EmptyState
				variant="dashed"
				icon="warning"
				title="Couldn't load"
				message={list.error}
			/>
		);
	}
	if (!list.loading && list.total === 0) {
		return <EmptyState variant="dashed" icon="search" {...empty} />;
	}
	return null;
}

// ── Artists ──

function ArtistsTab({ params, set }: TabProps) {
	const query = toQuery(params);
	const key = JSON.stringify(query);
	const list = usePagedList<ArtistSummary>(
		(page, pageSize) => musicService.artists({ ...query, page, pageSize }),
		key,
		60,
	);
	const order = query.order as Order;
	const fields: FilterField[] = [
		{
			kind: 'select',
			key: 'sort',
			label: 'Sort',
			options: [
				{ value: 'name', label: 'Name' },
				{ value: 'added', label: 'Recently added' },
				{ value: 'albums', label: 'Album count' },
			],
		},
	];

	return (
		<>
			<div class={styles.toolbar}>
				<SchemaFilterBar
					fields={fields}
					values={{ sort: query.sort ?? 'name' }}
					onChange={(v) => set({ sort: v.sort ?? '', order: '' })}
					count={list.total ?? undefined}
					countNoun={['artist', 'artists']}
				>
					<OrderToggle
						order={order}
						onToggle={() => set({ order: order === 'asc' ? 'desc' : 'asc' })}
					/>
				</SchemaFilterBar>
			</div>
			<ListStatus
				list={list}
				empty={{
					title: params.q ? 'No matching artists' : 'No artists yet',
					message: params.q ? `Nothing matches “${params.q}”.` : undefined,
				}}
			/>
			<CardGrid circle>
				{list.items.map((a) => (
					<ArtistCard key={a.id} artist={a} />
				))}
				{list.loading && <SkeletonTiles circle />}
			</CardGrid>
			<Sentinel onVisible={list.loadMore} />
		</>
	);
}

// ── Albums ──

function AlbumsTab({ params, set }: TabProps) {
	const query = toQuery(params);
	const key = JSON.stringify(query);
	const list = usePagedList<AlbumSummary>(
		(page, pageSize) => musicService.albums({ ...query, page, pageSize }),
		key,
		60,
	);
	const [view, setView] = useUiSetting<'grid' | 'list'>('music_albums_view', 'grid');
	const [genres, setGenres] = useState<{ name: string; albumCount: number }[]>([]);
	useEffect(() => {
		musicService
			.genres()
			.then(setGenres)
			.catch(() => {});
	}, []);
	const order = query.order as Order;

	const fields: FilterField[] = [
		{
			kind: 'select',
			key: 'sort',
			label: 'Sort',
			options: [
				{ value: 'added', label: 'Recently added' },
				{ value: 'title', label: 'Title' },
				{ value: 'artist', label: 'Artist' },
				{ value: 'year', label: 'Year' },
				{ value: 'rating', label: 'Rating' },
			],
		},
		{
			kind: 'select',
			key: 'genre',
			label: 'Genre',
			options: [
				{ value: '', label: 'All genres' },
				...genres.map((g) => ({ value: g.name, label: g.name })),
				// Keep a URL-pinned genre selectable even before /genres resolves.
				...(params.genre && !genres.some((g) => g.name === params.genre)
					? [{ value: params.genre, label: params.genre }]
					: []),
			],
		},
		{
			kind: 'number',
			key: 'yearFrom',
			placeholder: 'From year',
			min: 1900,
			max: 2100,
			width: '104px',
		},
		{
			kind: 'number',
			key: 'yearTo',
			placeholder: 'To year',
			min: 1900,
			max: 2100,
			width: '96px',
		},
		{
			kind: 'number',
			key: 'minRating',
			placeholder: 'Min ★',
			min: 0,
			max: 10,
			step: 0.5,
			width: '84px',
		},
	];

	return (
		<>
			<div class={styles.toolbar}>
				<SchemaFilterBar
					fields={fields}
					values={{
						sort: query.sort ?? 'added',
						genre: params.genre,
						yearFrom: params.yearFrom,
						yearTo: params.yearTo,
						minRating: params.minRating,
					}}
					onChange={(v) =>
						set({
							sort: v.sort ?? '',
							order: v.sort !== query.sort ? '' : params.order,
							genre: v.genre ?? '',
							yearFrom: v.yearFrom ?? '',
							yearTo: v.yearTo ?? '',
							minRating: v.minRating ?? '',
						})
					}
					count={list.total ?? undefined}
					countNoun={['album', 'albums']}
				>
					<OrderToggle
						order={order}
						onToggle={() => set({ order: order === 'asc' ? 'desc' : 'asc' })}
					/>
				</SchemaFilterBar>
				<div class={styles.viewToggle}>
					<button
						type="button"
						class={`${styles.iconBtn} ${view === 'grid' ? styles.iconBtnActive : ''}`}
						onClick={() => setView('grid')}
						aria-label="Grid view"
						title="Grid"
					>
						<Icon name="view-grid" size={16} />
					</button>
					<button
						type="button"
						class={`${styles.iconBtn} ${view === 'list' ? styles.iconBtnActive : ''}`}
						onClick={() => setView('list')}
						aria-label="List view"
						title="List"
					>
						<Icon name="view-list" size={16} />
					</button>
				</div>
			</div>

			<ListStatus
				list={list}
				empty={{
					title: 'No matching albums',
					message: 'Try clearing the search or loosening the filters.',
				}}
			/>

			{view === 'grid' ? (
				<CardGrid>
					{list.items.map((a) => (
						<AlbumCard key={a.id} album={a} />
					))}
					{list.loading && <SkeletonTiles />}
				</CardGrid>
			) : (
				<div class={styles.rowList}>
					{list.items.map((a) => (
						<MediaRow
							key={a.id}
							thumbUrl={a.artUrl ?? ''}
							thumbAlt={a.title}
							thumbFallbackLabel={a.title}
							thumbShape="square"
							title={a.title}
							subtitle={[
								a.artistCredit,
								a.year,
								`${a.trackCount} ${a.trackCount === 1 ? 'track' : 'tracks'}`,
								formatTotalLength(a.totalSeconds),
							]
								.filter(Boolean)
								.join(' · ')}
							href={`/album/${a.id}`}
							onClick={() => route(`/album/${a.id}`)}
							actions={
								<EntityOptionsMenu
									compact
									entity={{ type: 'album', id: a.id }}
									item={albumQueueItem(a)}
									artistId={a.artists[0]?.id ?? null}
								/>
							}
						/>
					))}
					{list.loading && <div class={styles.loadingLine}>Loading…</div>}
				</div>
			)}
			<Sentinel onVisible={list.loadMore} />
		</>
	);
}

// ── Tracks (virtualised) ──

const ROW_H = 44;
const OVERSCAN = 12;

type TrackSortKey = 'title' | 'artist' | 'album' | 'duration' | 'added' | 'rating';

function TracksTab({ params, set }: TabProps) {
	const query = toQuery(params);
	const key = JSON.stringify(query);
	const list = usePagedList<TrackSummary>(
		(page, pageSize) => musicService.tracks({ ...query, page, pageSize }),
		key,
		100,
	);
	const bodyRef = useRef<HTMLDivElement>(null);
	const [range, setRange] = useState<[number, number]>([0, 40]);
	// Optimistic per-track rating overrides (no per-row summary fetch).
	const [ratings, setRatings] = useState<Record<string, number>>({});

	const count = list.total ?? list.items.length;

	// Derive the visible slice from the body's viewport offset. The scroller is
	// usually the window, but in split-player mode it's the shell's content
	// column — a capture-phase listener catches scrolls from either.
	useEffect(() => {
		let raf = 0;
		const measure = () => {
			raf = 0;
			const el = bodyRef.current;
			if (!el) return;
			const top = el.getBoundingClientRect().top; // relative to viewport
			const start = Math.max(0, Math.floor(-top / ROW_H) - OVERSCAN);
			const visible = Math.ceil(window.innerHeight / ROW_H) + OVERSCAN * 2;
			setRange((prev) =>
				prev[0] === start && prev[1] === start + visible ? prev : [start, start + visible],
			);
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(measure);
		};
		measure();
		window.addEventListener('scroll', onScroll, { passive: true, capture: true });
		window.addEventListener('resize', onScroll);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			window.removeEventListener('scroll', onScroll, { capture: true });
			window.removeEventListener('resize', onScroll);
		};
	}, []);

	const start = Math.min(range[0], Math.max(0, count - 1));
	const end = Math.min(range[1], count);

	// Fetch the next page when the visible window approaches the loaded edge.
	useEffect(() => {
		if (list.loading) return;
		if (end > list.items.length - 20 && list.items.length < count) list.loadMore();
	}, [end, list.items.length, count, list.loading]);

	const sortKey = (query.sort ?? 'title') as TrackSortKey;
	const order = query.order as Order;
	const sortBy = (k: TrackSortKey) => {
		if (k === sortKey) set({ order: order === 'asc' ? 'desc' : 'asc' });
		else set({ sort: k, order: '' });
	};

	const rate = async (t: TrackSummary, value: number) => {
		const prev = ratings[t.id] ?? t.userRating ?? 0;
		setRatings((r) => ({ ...r, [t.id]: value }));
		try {
			const ref = { type: 'track' as const, id: t.id };
			if (value <= 0) await entitiesService.clearRating(ref);
			else await entitiesService.setRating(ref, value);
		} catch {
			setRatings((r) => ({ ...r, [t.id]: prev }));
			notifyError('Failed to save rating');
		}
	};

	const header = (k: TrackSortKey, label: string, cls?: string) => (
		<button
			type="button"
			class={`${styles.th} ${styles.thSortable} ${cls ?? ''} ${sortKey === k ? styles.thActive : ''}`}
			onClick={() => sortBy(k)}
			aria-pressed={sortKey === k}
			title={`Sort by ${label.toLowerCase()}`}
		>
			{label}
			{sortKey === k && <Icon name={order === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />}
		</button>
	);

	const rows = useMemo(() => {
		const out = [];
		for (let i = start; i < end; i++) {
			const t = list.items[i];
			if (!t) {
				out.push(
					<div key={`ph-${i}`} class={`${styles.tr} ${styles.trPlaceholder}`}>
						<span class={styles.tdNum}>{i + 1}</span>
						<span class={`${styles.phBar} skeleton`} />
					</div>,
				);
				continue;
			}
			const userRating = ratings[t.id] ?? t.userRating ?? 0;
			out.push(
				<div
					key={t.id}
					class={styles.tr}
					role="row"
					tabIndex={0}
					onClick={() => playTracksFrom(list.items, i)}
					onKeyDown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') playTracksFrom(list.items, i);
					}}
					title={`Play ${t.title}`}
				>
					<span class={styles.tdNum}>{i + 1}</span>
					<span class={styles.tdTitle}>
						<InlineLink href={`/track/${t.id}`} class={styles.cellLink}>
							{t.title}
						</InlineLink>
					</span>
					<span class={styles.tdMuted}>
						{t.artists.length > 0 ? (
							<ArtistLinks artists={t.artists} class={styles.cellLink} />
						) : (
							t.artistCredit
						)}
					</span>
					<span class={`${styles.tdMuted} ${styles.colAlbum}`}>
						<InlineLink href={`/album/${t.albumId}`} class={styles.cellLink}>
							{t.albumTitle}
						</InlineLink>
					</span>
					<span class={styles.tdDuration}>{formatDuration(t.durationSeconds)}</span>
					<span
						class={`${styles.tdRating} ${styles.colRating}`}
						onClick={(e: Event) => e.stopPropagation()}
					>
						<RatingWidget
							value={userRating}
							editable
							size="sm"
							onChange={(v) => void rate(t, v)}
						/>
					</span>
					<span class={styles.tdMenu} onClick={(e: Event) => e.stopPropagation()}>
						<EntityOptionsMenu
							compact
							entity={{ type: 'track', id: t.id }}
							item={trackQueueItem(t)}
							albumId={t.albumId}
							artistId={t.artists[0]?.id ?? null}
						/>
					</span>
				</div>,
			);
		}
		return out;
	}, [start, end, list.items, ratings]);

	return (
		<>
			<div class={styles.toolbar}>
				<span class={styles.count}>
					{list.total != null && `${list.total} ${list.total === 1 ? 'track' : 'tracks'}`}
				</span>
			</div>
			<ListStatus
				list={list}
				empty={{
					title: params.q ? 'No matching tracks' : 'No tracks yet',
					message: params.q ? `Nothing matches “${params.q}”.` : undefined,
				}}
			/>
			{(count > 0 || list.loading) && (
				<div class={styles.table} role="table" aria-label="Tracks" aria-rowcount={count}>
					<div class={`${styles.tr} ${styles.thead}`} role="row">
						<span class={`${styles.th} ${styles.tdNum}`}>#</span>
						{header('title', 'Title')}
						{header('artist', 'Artist')}
						{header('album', 'Album', styles.colAlbum)}
						{header('duration', 'Time', styles.thRight)}
						{header('rating', 'Rating', styles.colRating)}
						<span class={styles.th} aria-hidden="true" />
					</div>
					<div
						ref={bodyRef}
						style={{ height: `${count * ROW_H}px`, position: 'relative' }}
					>
						<div style={{ transform: `translateY(${start * ROW_H}px)` }}>{rows}</div>
					</div>
					{list.loading && count === 0 && <div class={styles.loadingLine}>Loading…</div>}
				</div>
			)}
		</>
	);
}

// ── Genres ──

function GenresTab({ q }: { q: string }) {
	const [genres, setGenres] = useState<{ name: string; albumCount: number }[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		musicService
			.genres()
			.then(setGenres)
			.catch((err) => setError((err as Error)?.message || 'Failed to load genres'));
	}, []);

	if (error) {
		return <EmptyState variant="dashed" icon="warning" title="Couldn't load" message={error} />;
	}
	if (genres === null) return <div class={styles.loadingLine}>Loading…</div>;

	const needle = q.trim().toLowerCase();
	const shown = (needle ? genres.filter((g) => g.name.toLowerCase().includes(needle)) : genres)
		.slice()
		.sort((a, b) => b.albumCount - a.albumCount || a.name.localeCompare(b.name));

	if (shown.length === 0) {
		return (
			<EmptyState
				variant="dashed"
				icon="search"
				title={needle ? 'No matching genres' : 'No genres yet'}
				message={needle ? undefined : 'Genres come from your music tags and metadata.'}
			/>
		);
	}

	return (
		<div class={styles.genreGrid}>
			{shown.map((g) => {
				const href = `/music/library?tab=albums&genre=${encodeURIComponent(g.name)}`;
				return (
					<InlineLink key={g.name} href={href} class={styles.genreCard}>
						<span class={styles.genreName}>{g.name}</span>
						<span class={styles.genreCount}>
							{g.albumCount} {g.albumCount === 1 ? 'album' : 'albums'}
						</span>
					</InlineLink>
				);
			})}
		</div>
	);
}

function SkeletonTiles({ circle }: { circle?: boolean }) {
	return (
		<>
			{Array.from({ length: 6 }).map((_, i) => (
				<div
					key={`sk-${i}`}
					class={`${styles.skeletonTile} ${circle ? styles.skeletonCircle : ''} skeleton`}
					aria-hidden="true"
				/>
			))}
		</>
	);
}

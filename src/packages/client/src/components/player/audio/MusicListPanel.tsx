import type { AlbumDetail, TrackSummary } from '@mu/shared';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { formatTime } from '@/components/player/controls/formatTime';
import qStyles from '@/components/player/QueuePanel.module.scss';
import { musicService } from '@/services/music.service';
import {
	contextTracks,
	currentTrack,
	type MusicPanelTab,
	musicPanelTab,
	playbackContext,
	playQueued,
	playTrack,
	playTracks,
	seekAudio,
	trackToQueueItem,
} from '@/state/musicPlayer.state';
import { currentTime } from '@/state/player.state';
import {
	addToQueue,
	audioQueue,
	clearQueue,
	moveInQueue,
	queueItemKey,
	removeFromQueue,
} from '@/state/queue.state';
import { activeLrcIndex, type LrcLine, parseLrc } from '@/utils/lrc';
import { artAtSize } from '@/utils/music-art';
import styles from './MusicListPanel.module.scss';

interface MusicListPanelProps {
	/** flyout = toolbar popover (mini); side = full-mode side panel; split = split-mode list. */
	variant: 'flyout' | 'side' | 'split';
	onClose?: () => void;
}

const albumCache = new Map<string, Promise<AlbumDetail>>();
const lyricsCache = new Map<
	string,
	Promise<{ plain: string | null; syncedLrc: string | null } | null>
>();
const recommendedCache = new Map<string, Promise<TrackSummary[]>>();

function loadAlbum(id: string): Promise<AlbumDetail> {
	let p = albumCache.get(id);
	if (!p) {
		p = musicService.album(id);
		p.catch(() => albumCache.delete(id));
		albumCache.set(id, p);
	}
	return p;
}

/** Resolve a cached promise into component state, re-running when `key` changes. */
function useAsync<T>(key: string | null, load: (key: string) => Promise<T>) {
	const [state, setState] = useState<{ key: string | null; data: T | null; loading: boolean }>({
		key: null,
		data: null,
		loading: false,
	});
	useEffect(() => {
		if (!key) {
			setState({ key: null, data: null, loading: false });
			return;
		}
		let cancelled = false;
		setState({ key, data: null, loading: true });
		load(key)
			.then((data) => {
				if (!cancelled) setState({ key, data, loading: false });
			})
			.catch(() => {
				if (!cancelled) setState({ key, data: null, loading: false });
			});
		return () => {
			cancelled = true;
		};
	}, [key]);
	return state;
}

/**
 * The music list panel: Up Next · Album · Playlist/Artist · Recommended ·
 * Lyrics. Rows reuse the queue panel's styles (and its drag reorder for Up
 * Next).
 */
export function MusicListPanel({ variant, onClose }: MusicListPanelProps) {
	const ctx = playbackContext.value;
	const hasContextList =
		(ctx?.type === 'playlist' || ctx?.type === 'artist') && contextTracks.value.length > 0;
	const tabs: { id: MusicPanelTab; label: string }[] = [
		{ id: 'upnext', label: 'Up Next' },
		{ id: 'album', label: 'Album' },
		...(hasContextList
			? [{ id: 'playlist' as const, label: ctx?.type === 'artist' ? 'Artist' : 'Playlist' }]
			: []),
		{ id: 'recommended', label: 'Recommended' },
		{ id: 'lyrics', label: 'Lyrics' },
	];
	const selected = musicPanelTab.value;
	const tab = tabs.some((t) => t.id === selected) ? selected : 'upnext';

	return (
		<div class={`${qStyles.panel} ${styles.panel} ${styles[variant]}`} data-player-panel>
			<div class={`${qStyles.header} ${styles.header}`}>
				<div class={styles.tabs} role="tablist">
					{tabs.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							aria-selected={tab === t.id}
							class={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
							onClick={() => {
								musicPanelTab.value = t.id;
							}}
						>
							{t.label}
							{t.id === 'upnext' && audioQueue.value.length > 0 && (
								<span class={qStyles.count}>{audioQueue.value.length}</span>
							)}
						</button>
					))}
				</div>
				{onClose && (
					<button
						type="button"
						class={qStyles.closeBtn}
						onClick={onClose}
						aria-label="Close list"
					>
						<Icon name="x" size={14} />
					</button>
				)}
			</div>
			<div class={styles.body}>
				{tab === 'upnext' && <UpNextTab />}
				{tab === 'album' && <AlbumTab />}
				{tab === 'playlist' && <ContextTab />}
				{tab === 'recommended' && <RecommendedTab />}
				{tab === 'lyrics' && <LyricsTab />}
			</div>
		</div>
	);
}

// ── Rows ──

interface TrackRowProps {
	track: TrackSummary;
	/** Leading label (track number / position). */
	lead?: string | number | null;
	active?: boolean;
	onPlay: () => void;
	onQueue?: () => void;
}

function TrackRow({ track, lead, active, onPlay, onQueue }: TrackRowProps) {
	return (
		<li class={`${qStyles.item} ${styles.row} ${active ? styles.rowActive : ''}`}>
			{lead != null && <span class={qStyles.position}>{lead}</span>}
			<div class={`${qStyles.poster} ${styles.art}`}>
				{track.artUrl ? (
					<img src={artAtSize(track.artUrl, 256)!} alt="" loading="lazy" />
				) : (
					<div class={qStyles.posterPlaceholder} />
				)}
			</div>
			<button
				type="button"
				class={styles.rowMain}
				onClick={onPlay}
				title={`Play "${track.title}"`}
			>
				<span class={qStyles.title}>{track.title}</span>
				<span class={qStyles.year}>
					{track.artistCredit || track.artists.map((a) => a.name).join(', ')}
				</span>
			</button>
			{track.durationSeconds ? (
				<span class={styles.duration}>{formatTime(track.durationSeconds)}</span>
			) : null}
			{onQueue && (
				<button
					type="button"
					class={qStyles.removeBtn}
					onClick={onQueue}
					title="Add to queue"
					aria-label={`Add ${track.title} to queue`}
				>
					<Icon name="plus" size={12} />
				</button>
			)}
		</li>
	);
}

function Empty({ children }: { children: ComponentChildren }) {
	return <p class={qStyles.empty}>{children}</p>;
}

// ── Up Next ──

function UpNextTab() {
	const items = audioQueue.value;
	const now = currentTrack.value;
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);

	const drop = (to: number) => {
		if (dragIndex !== null) moveInQueue(dragIndex, to, 'audio');
		setDragIndex(null);
		setOverIndex(null);
	};

	return (
		<>
			{now && (
				<ul class={qStyles.list}>
					<TrackRow track={now.track} lead="Now" active onPlay={() => {}} />
				</ul>
			)}
			{items.length === 0 ? (
				<Empty>Nothing up next. Add tracks with “Add to Queue” or play an album.</Empty>
			) : (
				<>
					<div class={styles.subHeader}>
						<span>Up next</span>
						<button
							type="button"
							class={qStyles.clearBtn}
							onClick={() => clearQueue('audio')}
						>
							Clear
						</button>
					</div>
					<ul class={qStyles.list}>
						{items.map((item, i) => (
							<li
								key={queueItemKey(item)}
								class={`${qStyles.item} ${styles.row} ${dragIndex === i ? qStyles.dragging : ''} ${
									overIndex === i && dragIndex !== i ? qStyles.dragOver : ''
								}`}
								draggable
								onDragStart={() => setDragIndex(i)}
								onDragOver={(e) => {
									e.preventDefault();
									setOverIndex(i);
								}}
								onDragEnd={() => {
									setDragIndex(null);
									setOverIndex(null);
								}}
								onDrop={(e) => {
									e.preventDefault();
									drop(i);
								}}
							>
								<span class={qStyles.handle} aria-hidden="true">
									<Icon name="grip" size={12} />
								</span>
								<div class={`${qStyles.poster} ${styles.art}`}>
									{item.artUrl ? (
										<img
											src={artAtSize(item.artUrl, 256)!}
											alt=""
											loading="lazy"
										/>
									) : (
										<div class={qStyles.posterPlaceholder} />
									)}
								</div>
								<button
									type="button"
									class={styles.rowMain}
									onClick={() => void playQueued(item)}
									title={`Play "${item.title}" now`}
								>
									<span class={qStyles.title}>{item.title}</span>
									{item.subtitle ? (
										<span class={qStyles.year}>{item.subtitle}</span>
									) : null}
								</button>
								{item.durationSeconds ? (
									<span class={styles.duration}>
										{formatTime(item.durationSeconds)}
									</span>
								) : null}
								<button
									type="button"
									class={qStyles.removeBtn}
									onClick={() => removeFromQueue(item.ref)}
									title="Remove from queue"
									aria-label={`Remove ${item.title} from queue`}
								>
									<Icon name="x" size={12} />
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</>
	);
}

// ── Album ──

function AlbumTab() {
	const now = currentTrack.value;
	const albumId = now?.track.albumId ?? null;
	const { data: album, loading } = useAsync(albumId, loadAlbum);
	if (!now) return <Empty>Nothing playing.</Empty>;
	if (loading) return <Empty>Loading album…</Empty>;
	if (!album) return <Empty>Album details are unavailable.</Empty>;
	return (
		<>
			<div class={styles.subHeader}>
				<span title={album.title}>
					{album.title}
					{album.year ? ` · ${album.year}` : ''}
				</span>
			</div>
			<ul class={qStyles.list}>
				{album.tracks.map((t, i) => (
					<TrackRow
						key={t.id}
						track={t}
						lead={t.trackNo ?? i + 1}
						active={t.id === now.track.id}
						onPlay={() =>
							void playTracks(album.tracks, i, {
								type: 'album',
								id: album.id,
								title: album.title,
							})
						}
						onQueue={() => addToQueue(trackToQueueItem(t))}
					/>
				))}
			</ul>
		</>
	);
}

// ── Playlist / artist context ──

function ContextTab() {
	const ctx = playbackContext.value;
	const tracks = contextTracks.value;
	const nowId = currentTrack.value?.track.id;
	if (!ctx || tracks.length === 0) return <Empty>No playlist is playing.</Empty>;
	return (
		<>
			<div class={styles.subHeader}>
				<span title={ctx.title}>{ctx.title}</span>
			</div>
			<ul class={qStyles.list}>
				{tracks.map((t, i) => (
					<TrackRow
						key={`${t.id}:${i}`}
						track={t}
						lead={i + 1}
						active={t.id === nowId}
						onPlay={() => void playTracks(tracks, i, ctx)}
						onQueue={() => addToQueue(trackToQueueItem(t))}
					/>
				))}
			</ul>
		</>
	);
}

// ── Recommended (v1: the artist's most played, outside this album) ──

function loadRecommended(key: string): Promise<TrackSummary[]> {
	let p = recommendedCache.get(key);
	if (!p) {
		const [artistId, albumId] = key.split('|');
		p = musicService
			.tracks({ artistId, sort: 'plays', pageSize: 20 })
			.then((page) => page.items.filter((t) => t.albumId !== albumId));
		p.catch(() => recommendedCache.delete(key));
		recommendedCache.set(key, p);
	}
	return p;
}

function RecommendedTab() {
	const now = currentTrack.value;
	const artistId = now?.track.artists[0]?.id ?? null;
	const key = artistId && now ? `${artistId}|${now.track.albumId}` : null;
	const { data, loading } = useAsync(key, loadRecommended);
	if (!now) return <Empty>Nothing playing.</Empty>;
	if (!artistId) return <Empty>No recommendations for this track.</Empty>;
	if (loading) return <Empty>Loading…</Empty>;
	if (!data || data.length === 0) return <Empty>No other tracks by this artist yet.</Empty>;
	return (
		<>
			<div class={styles.subHeader}>
				<span>More from {now.track.artists[0]?.name}</span>
			</div>
			<ul class={qStyles.list}>
				{data.map((t) => (
					<TrackRow
						key={t.id}
						track={t}
						onPlay={() => void playTrack(t)}
						onQueue={() => addToQueue(trackToQueueItem(t))}
					/>
				))}
			</ul>
		</>
	);
}

// ── Lyrics ──

function loadLyrics(trackId: string) {
	let p = lyricsCache.get(trackId);
	if (!p) {
		p = musicService.lyrics(trackId).catch(() => null);
		lyricsCache.set(trackId, p);
	}
	return p;
}

function LyricsTab() {
	const trackId = currentTrack.value?.track.id ?? null;
	const { data, loading } = useAsync(trackId, loadLyrics);
	const synced: LrcLine[] | null = data?.syncedLrc ? parseLrc(data.syncedLrc) : null;
	if (!trackId) return <Empty>Nothing playing.</Empty>;
	if (loading) return <Empty>Loading lyrics…</Empty>;
	if (synced && synced.length > 0) return <SyncedLyrics lines={synced} />;
	if (data?.plain?.trim()) return <div class={styles.lyricsPlain}>{data.plain}</div>;
	return <Empty>No lyrics for this track.</Empty>;
}

function SyncedLyrics({ lines }: { lines: LrcLine[] }) {
	const active = activeLrcIndex(lines, currentTime.value);
	const boxRef = useRef<HTMLDivElement>(null);
	// Keep the current line centred — scroll the panel itself, never the page.
	useEffect(() => {
		const box = boxRef.current;
		const el = box?.querySelector<HTMLElement>(`[data-line="${active}"]`);
		if (!box || !el) return;
		const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
		box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
	}, [active]);
	return (
		<div class={styles.lyricsSynced} ref={boxRef}>
			{lines.map((l, i) => (
				<button
					type="button"
					key={`${l.time}:${i}`}
					data-line={i}
					class={`${styles.lyricLine} ${i === active ? styles.lyricActive : ''} ${
						i < active ? styles.lyricPast : ''
					}`}
					onClick={() => seekAudio(l.time)}
				>
					{l.text || '♪'}
				</button>
			))}
		</div>
	);
}

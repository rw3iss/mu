import type {
	AlbumDetail as AlbumDetailDto,
	AlbumSummary,
	TrackFileInfo,
	TrackSummary,
} from '@mu/shared';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CommentsPanel } from '@/components/comments/CommentsPanel';
import { Button } from '@/components/common/Button';
import { Collapse } from '@/components/common/Collapse';
import { EntityOptionsMenu } from '@/components/common/EntityOptionsMenu';
import { EntityPlaylists } from '@/components/common/EntityPlaylists';
import { EntityRating } from '@/components/common/EntityRating';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { AlbumEditModal } from '@/components/music/AlbumEditModal';
import { AlbumFilmLinks } from '@/components/music/AlbumFilmLinks';
import { AlbumMatchModal } from '@/components/music/AlbumMatchModal';
import { ArtistLinks, InlineLink } from '@/components/music/InlineLink';
import { AlbumCard, MusicRail } from '@/components/music/MusicCards';
import { OfflineDownloadButton } from '@/components/music/OfflineDownloadButton';
import { TrackRow } from '@/components/music/TrackRow';
import { useSeo } from '@/hooks/useSeo';
import { musicService } from '@/services/music.service';
import { can } from '@/state/auth.state';
import { ensureFavoritesLoaded } from '@/state/favorites.state';
import { changeAffects, musicChange } from '@/state/musicLibraryEvents.state';
import {
	albumQueueItem,
	formatBitrate,
	formatFileSize,
	formatSampleRate,
	formatTotalLength,
	playMusic,
	playTracksFrom,
	queueTracks,
	releaseTypeLabel,
	shuffleTracks,
} from '@/utils/music';
import styles from './MusicDetail.module.scss';

interface AlbumDetailProps {
	path?: string;
	id?: string;
}

/** Roles that count as the main performer — everything else is a "credit". */
const MAIN_ROLES = new Set(['main', 'primary', 'artist', 'album artist', 'albumartist', '']);
/** Cap on per-track detail fetches for the File info table. */
const FILE_INFO_MAX = 50;

export function AlbumDetail({ id }: AlbumDetailProps) {
	const [album, setAlbum] = useState<AlbumDetailDto | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [moreByArtist, setMoreByArtist] = useState<AlbumSummary[]>([]);
	const [filesOpen, setFilesOpen] = useState(false);
	const [files, setFiles] = useState<Record<string, TrackFileInfo[]> | null>(null);
	const [filesLoading, setFilesLoading] = useState(false);
	const [matchOpen, setMatchOpen] = useState(false);
	const [editMode, setEditMode] = useState<'merge' | 'split' | null>(null);
	const canEdit = can('edit:media');

	/** Re-read the album after a metadata change (match applied). */
	const reloadAlbum = () => {
		if (!id) return;
		musicService
			.album(id)
			.then(setAlbum)
			.catch(() => {});
	};
	// Live refresh when the server reports a change to this album.
	const change = musicChange.value;
	useEffect(() => {
		if (change.version === 0 || !id || !changeAffects(change, [id])) return;
		reloadAlbum();
	}, [change.version]);

	useSeo(
		album
			? {
					title: album.artistCredit
						? `${album.title} — ${album.artistCredit}`
						: album.title,
					description: [album.artistCredit, album.year, `${album.trackCount} tracks`]
						.filter(Boolean)
						.join(' · '),
					image: album.artUrl ?? undefined,
				}
			: null,
	);

	useEffect(() => {
		void ensureFavoritesLoaded();
	}, []);

	useEffect(() => {
		if (!id) {
			setIsLoading(false);
			setError('Missing album id');
			return;
		}
		let cancelled = false;
		setIsLoading(true);
		setError(null);
		setAlbum(null);
		setMoreByArtist([]);
		setFilesOpen(false);
		setFiles(null);
		musicService
			.album(id)
			.then((a) => !cancelled && setAlbum(a))
			.catch((err) => !cancelled && setError(err?.message ?? 'Failed to load album'))
			.finally(() => !cancelled && setIsLoading(false));
		return () => {
			cancelled = true;
		};
	}, [id]);

	// "More by artist" — lazily after the album itself has rendered.
	const primaryArtistId = album?.artists[0]?.id ?? null;
	useEffect(() => {
		if (!album || !primaryArtistId) return;
		let cancelled = false;
		musicService
			.artist(primaryArtistId)
			.then((a) => {
				if (cancelled) return;
				setMoreByArtist(
					a.albums
						.filter((x) => x.id !== album.id)
						.sort((x, y) => (y.year ?? 0) - (x.year ?? 0)),
				);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [album?.id, primaryArtistId]);

	// File info — fetched per track, sequentially, only once expanded.
	useEffect(() => {
		if (!filesOpen || files || filesLoading || !album) return;
		let cancelled = false;
		setFilesLoading(true);
		(async () => {
			const out: Record<string, TrackFileInfo[]> = {};
			for (const t of album.tracks.slice(0, FILE_INFO_MAX)) {
				if (cancelled) return;
				try {
					const d = await musicService.track(t.id);
					out[t.id] = d.files;
				} catch {
					out[t.id] = [];
				}
			}
			if (!cancelled) setFiles(out);
		})().finally(() => !cancelled && setFilesLoading(false));
		return () => {
			cancelled = true;
		};
	}, [filesOpen, album?.id]);

	const discs = useMemo(() => {
		if (!album) return [];
		const map = new Map<number, { track: TrackSummary; index: number }[]>();
		album.tracks.forEach((track, index) => {
			const d = track.discNo || 1;
			const list = map.get(d) ?? [];
			list.push({ track, index });
			map.set(d, list);
		});
		return [...map.entries()].sort((a, b) => a[0] - b[0]);
	}, [album]);

	const credits = useMemo(() => {
		if (!album) return [];
		const byRole = new Map<string, Map<string, string>>();
		for (const t of album.tracks) {
			for (const a of t.artists) {
				const role = (a.role ?? '').toLowerCase();
				if (MAIN_ROLES.has(role)) continue;
				const names = byRole.get(a.role) ?? new Map<string, string>();
				names.set(a.id, a.name);
				byRole.set(a.role, names);
			}
		}
		return [...byRole.entries()]
			.map(([role, names]) => ({
				role,
				artists: [...names.entries()].map(([aid, name]) => ({ id: aid, name })),
			}))
			.sort((a, b) => a.role.localeCompare(b.role));
	}, [album]);

	if (isLoading) return <AlbumSkeleton />;

	if (error || !album) {
		return (
			<div class={styles.notFound}>
				<h2>Album not found</h2>
				{error && <p>{error}</p>}
			</div>
		);
	}

	const albumArtistIds = album.artists.map((a) => a.id);
	const typeLabel = [releaseTypeLabel(album.primaryType), ...album.secondaryTypes]
		.filter(Boolean)
		.join(' · ');
	const yearLabel =
		album.originalYear && album.year && album.originalYear !== album.year
			? `${album.year} (orig. ${album.originalYear})`
			: (album.year ?? album.originalYear);
	const facts = [
		yearLabel ? String(yearLabel) : null,
		typeLabel,
		album.label,
		`${album.trackCount} ${album.trackCount === 1 ? 'track' : 'tracks'}`,
		formatTotalLength(album.totalSeconds) || null,
	].filter(Boolean) as string[];

	const playAll = () =>
		album.tracks.length > 0
			? playTracksFrom(album.tracks, 0, { type: 'album', id: album.id, title: album.title })
			: playMusic({ type: 'album', id: album.id });

	return (
		<div class={styles.page}>
			{album.artUrl && (
				<div class={styles.backdrop} aria-hidden="true">
					<SmartImage src={album.artUrl} alt="" imgClass={styles.backdropImage} />
					<div class={styles.backdropGradient} />
				</div>
			)}
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={styles.artWrap}>
						<SmartImage
							src={album.artUrl}
							alt={album.title}
							class={styles.art}
							imgClass={styles.art}
							fallbackLabel={album.title}
						/>
					</div>
					<div class={styles.heroInfo}>
						<span class={styles.kicker}>{releaseTypeLabel(album.primaryType)}</span>
						<h1 class={styles.title}>{album.title}</h1>
						<div class={styles.byline}>
							{album.artists.length > 0 ? (
								<ArtistLinks artists={album.artists} class={styles.link} />
							) : (
								album.artistCredit
							)}
						</div>
						<div class={styles.facts}>
							{facts.map((f) => (
								<span key={f}>{f}</span>
							))}
						</div>
						{album.genres.length > 0 && (
							<div class={styles.chips}>
								{album.genres.map((g) => (
									<InlineLink
										key={g}
										href={`/music/library?tab=albums&genre=${encodeURIComponent(g)}`}
										class={styles.chip}
									>
										{g}
									</InlineLink>
								))}
							</div>
						)}
						<AlbumFilmLinks albumId={album.id} class={styles.byline} />
						<div class={styles.ratingRow}>
							<EntityRating
								entity={{ type: 'album', id: album.id }}
								initialUserRating={album.userRating ?? null}
							/>
							<FavoriteButton entityType="album" entityId={album.id} size="large" />
						</div>
						<div class={styles.actions}>
							<Button onClick={playAll}>
								<span class={styles.btnIcon}>
									<Icon name="play" size={16} /> Play
								</span>
							</Button>
							<Button
								variant="secondary"
								disabled={album.tracks.length === 0}
								onClick={() =>
									shuffleTracks(album.tracks, {
										type: 'album',
										id: album.id,
										title: album.title,
									})
								}
							>
								<span class={styles.btnIcon}>
									<Icon name="shuffle" size={16} /> Shuffle
								</span>
							</Button>
							<Button
								variant="secondary"
								disabled={album.tracks.length === 0}
								onClick={() => queueTracks(album.tracks)}
							>
								<span class={styles.btnIcon}>
									<Icon name="list-plus" size={16} /> Add to queue
								</span>
							</Button>
							<OfflineDownloadButton
								kind="album"
								id={album.id}
								title={album.title}
								tracks={album.tracks}
								size="md"
							/>
							{canEdit && (
								<>
									<Button variant="secondary" onClick={() => setMatchOpen(true)}>
										<span class={styles.btnIcon}>
											<Icon name="search" size={16} /> Match
										</span>
									</Button>
									<Button variant="ghost" onClick={() => setEditMode('merge')}>
										Merge…
									</Button>
									{album.tracks.length > 1 && (
										<Button
											variant="ghost"
											onClick={() => setEditMode('split')}
										>
											Split…
										</Button>
									)}
								</>
							)}
							<EntityOptionsMenu
								entity={{ type: 'album', id: album.id }}
								item={albumQueueItem(album)}
								artistId={primaryArtistId}
								actions={[
									'playNext',
									'addToQueue',
									'playlist',
									'rate',
									'favorite',
									'goArtist',
									'share',
								]}
							/>
						</div>
					</div>
				</header>

				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Tracks</h2>
					{album.tracks.length === 0 ? (
						<p class={styles.muted}>No tracks found for this album.</p>
					) : (
						<div class={styles.trackList}>
							{discs.map(([disc, rows]) => (
								<div key={disc}>
									{discs.length > 1 && (
										<div class={styles.discHeader}>
											<Icon name="disc" size={14} /> Disc {disc}
										</div>
									)}
									{rows.map(({ track, index }) => (
										<TrackRow
											key={track.id}
											track={track}
											index={track.trackNo ?? index + 1}
											albumArtistIds={albumArtistIds}
											showRating
											onPlay={() =>
												playTracksFrom(album.tracks, index, {
													type: 'album',
													id: album.id,
													title: album.title,
												})
											}
										/>
									))}
								</div>
							))}
						</div>
					)}
				</section>

				{credits.length > 0 && (
					<section class={styles.section}>
						<h2 class={styles.sectionTitle}>Credits</h2>
						<div class={styles.credits}>
							{credits.map((c) => (
								<div key={c.role}>
									<div class={styles.creditRole}>{c.role}</div>
									<div class={styles.creditNames}>
										<ArtistLinks artists={c.artists} class={styles.link} />
									</div>
								</div>
							))}
						</div>
					</section>
				)}

				{album.releases.length > 1 && (
					<section class={styles.section}>
						<h2 class={styles.sectionTitle}>Other editions</h2>
						<div class={styles.tableWrap}>
							<table class={styles.table}>
								<thead>
									<tr>
										<th>Date</th>
										<th>Label</th>
										<th>Country</th>
										<th>Format</th>
									</tr>
								</thead>
								<tbody>
									{album.releases.map((r) => (
										<tr key={r.id}>
											<td>{r.releaseDate ?? '—'}</td>
											<td>{r.label ?? '—'}</td>
											<td>{r.country ?? '—'}</td>
											<td>{r.mediaFormat ?? '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				)}

				{moreByArtist.length > 0 && (
					<MusicRail
						title={`More by ${album.artists[0]?.name ?? album.artistCredit ?? 'this artist'}`}
					>
						{moreByArtist.map((a) => (
							<AlbumCard key={a.id} album={a} showType />
						))}
					</MusicRail>
				)}

				<section class={styles.section}>
					<EntityPlaylists entity={{ type: 'album', id: album.id }} />
				</section>

				{album.tracks.length > 0 && (
					<section class={styles.section}>
						<div class={styles.sectionToggleWrap}>
							<button
								type="button"
								class={styles.sectionToggle}
								onClick={() => setFilesOpen(!filesOpen)}
								aria-expanded={filesOpen}
							>
								<h2 class={styles.sectionTitle}>File info</h2>
								<Icon name={filesOpen ? 'chevron-up' : 'chevron-down'} size={16} />
							</button>
						</div>
						<Collapse open={filesOpen}>
							{filesLoading || !files ? (
								<p class={styles.muted}>Loading file details…</p>
							) : (
								<FileInfoTable tracks={album.tracks} files={files} />
							)}
						</Collapse>
					</section>
				)}

				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Comments</h2>
					<CommentsPanel entity={{ type: 'album', id: album.id }} />
				</section>
			</div>
			{canEdit && (
				<AlbumMatchModal
					isOpen={matchOpen}
					onClose={() => setMatchOpen(false)}
					albumId={album.id}
					albumTitle={album.title}
					artistCredit={album.artistCredit}
					onMatched={() => setTimeout(reloadAlbum, 4000)}
				/>
			)}
			{canEdit && (
				<AlbumEditModal mode={editMode} onClose={() => setEditMode(null)} album={album} />
			)}
		</div>
	);
}

function FileInfoTable({
	tracks,
	files,
}: {
	tracks: TrackSummary[];
	files: Record<string, TrackFileInfo[]>;
}) {
	return (
		<div class={styles.tableWrap}>
			<table class={styles.table}>
				<thead>
					<tr>
						<th>#</th>
						<th>Track</th>
						<th>Format</th>
						<th>Codec</th>
						<th>Bitrate</th>
						<th>Sample rate</th>
						<th>Bit depth</th>
						<th>Ch</th>
						<th>Size</th>
					</tr>
				</thead>
				<tbody>
					{tracks
						.filter((t) => files[t.id])
						.flatMap((t) => {
							const list = files[t.id] ?? [];
							if (list.length === 0) {
								return [
									<tr key={t.id}>
										<td>{t.trackNo ?? ''}</td>
										<td>{t.title}</td>
										<td colSpan={7}>—</td>
									</tr>,
								];
							}
							return list.map((f) => (
								<tr key={f.id} title={f.fileName}>
									<td>{t.trackNo ?? ''}</td>
									<td class={styles.fileName}>{t.title}</td>
									<td>
										{f.container?.toUpperCase() ?? '—'}{' '}
										{f.lossless && <span class={styles.badge}>Lossless</span>}
									</td>
									<td>{f.codec ?? '—'}</td>
									<td>{formatBitrate(f.bitrate)}</td>
									<td>{formatSampleRate(f.sampleRate)}</td>
									<td>{f.bitDepth ? `${f.bitDepth}-bit` : '—'}</td>
									<td>{f.channels ?? '—'}</td>
									<td>{formatFileSize(f.fileSize)}</td>
								</tr>
							));
						})}
				</tbody>
			</table>
		</div>
	);
}

function AlbumSkeleton() {
	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={`${styles.artWrap} ${styles.skeletonBlock}`} />
					<div class={styles.heroInfo}>
						<div class={`${styles.skeletonLine} ${styles.skeletonLineLarge}`} />
						<div class={styles.skeletonLine} />
						<div class={styles.skeletonLine} />
					</div>
				</header>
				<section class={styles.section}>
					{[...Array(8)].map((_, i) => (
						<div key={i} class={styles.skeletonLine} style={{ width: '100%' }} />
					))}
				</section>
			</div>
		</div>
	);
}

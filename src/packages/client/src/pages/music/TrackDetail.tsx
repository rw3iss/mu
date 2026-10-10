import type { TrackDetail as TrackDetailDto } from '@mu/shared';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CommentsPanel } from '@/components/comments/CommentsPanel';
import { Button } from '@/components/common/Button';
import { EntityOptionsMenu } from '@/components/common/EntityOptionsMenu';
import { EntityRating } from '@/components/common/EntityRating';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { ArtistLinks, InlineLink } from '@/components/music/InlineLink';
import { AlbumCard, MusicRail } from '@/components/music/MusicCards';
import { useSeo } from '@/hooks/useSeo';
import { musicService } from '@/services/music.service';
import { can } from '@/state/auth.state';
import { ensureFavoritesLoaded } from '@/state/favorites.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import {
	formatBitrate,
	formatDuration,
	formatFileSize,
	formatSampleRate,
	playMusic,
	trackQueueItem,
} from '@/utils/music';
import styles from './MusicDetail.module.scss';

interface TrackDetailProps {
	path?: string;
	id?: string;
}

type Lyrics = { plain: string | null; syncedLrc: string | null; source: string | null };

/** `[mm:ss.xx]` / `[m:ss]` LRC stamp at the start of a line (may repeat). */
const LRC_STAMP = /^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/;
const LRC_META = /^\s*\[[a-z]+:.*\]\s*$/i;

interface LrcLine {
	time: string | null;
	text: string;
}

/** Parse LRC into display lines: timestamp (mm:ss) + text; metadata tags dropped. */
function parseLrc(lrc: string): LrcLine[] {
	const out: LrcLine[] = [];
	for (const raw of lrc.split(/\r?\n/)) {
		if (LRC_META.test(raw)) continue;
		const m = raw.match(LRC_STAMP);
		if (m) {
			const first = m[1]!.match(/\[(\d{1,3}):(\d{2})/);
			const time = first ? `${first[1]!.padStart(2, '0')}:${first[2]}` : null;
			out.push({ time, text: m[2]!.trim() });
		} else if (raw.trim()) {
			out.push({ time: null, text: raw.trim() });
		}
	}
	return out;
}

export function TrackDetail({ id }: TrackDetailProps) {
	const [track, setTrack] = useState<TrackDetailDto | null>(null);
	const [lyrics, setLyrics] = useState<Lyrics | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [draftPlain, setDraftPlain] = useState('');
	const [draftSynced, setDraftSynced] = useState('');
	const [saving, setSaving] = useState(false);
	const canEdit = can('edit:lyrics');

	useSeo(
		track
			? {
					title: track.artistCredit
						? `${track.title} — ${track.artistCredit}`
						: track.title,
					description: [track.artistCredit, track.albumTitle].filter(Boolean).join(' · '),
					image: track.artUrl ?? undefined,
				}
			: null,
	);

	useEffect(() => {
		void ensureFavoritesLoaded();
	}, []);

	useEffect(() => {
		if (!id) {
			setIsLoading(false);
			setError('Missing track id');
			return;
		}
		let cancelled = false;
		setIsLoading(true);
		setError(null);
		setTrack(null);
		setLyrics(null);
		setEditing(false);
		musicService
			.track(id)
			.then((t) => {
				if (cancelled) return;
				setTrack(t);
				if (t.lyrics) {
					setLyrics(t.lyrics);
				} else {
					// Not cached with the detail — ask the lyrics endpoint (may fetch).
					musicService
						.lyrics(t.id)
						.then((l) => !cancelled && setLyrics(l))
						.catch(() => {});
				}
			})
			.catch((err) => !cancelled && setError(err?.message ?? 'Failed to load track'))
			.finally(() => !cancelled && setIsLoading(false));
		return () => {
			cancelled = true;
		};
	}, [id]);

	const syncedLines = useMemo(
		() => (lyrics?.syncedLrc ? parseLrc(lyrics.syncedLrc) : null),
		[lyrics?.syncedLrc],
	);

	const credits = useMemo(() => {
		if (!track) return [];
		const byRole = new Map<string, { id: string; name: string }[]>();
		for (const c of track.credits) {
			const list = byRole.get(c.role) ?? [];
			if (!list.some((x) => x.id === c.artistId)) list.push({ id: c.artistId, name: c.name });
			byRole.set(c.role, list);
		}
		return [...byRole.entries()].map(([role, artists]) => ({ role, artists }));
	}, [track]);

	if (isLoading) return <TrackSkeleton />;

	if (error || !track) {
		return (
			<div class={styles.notFound}>
				<h2>Track not found</h2>
				{error && <p>{error}</p>}
			</div>
		);
	}

	const startEdit = () => {
		setDraftPlain(lyrics?.plain ?? '');
		setDraftSynced(lyrics?.syncedLrc ?? '');
		setEditing(true);
	};

	const [fetchingLyrics, setFetchingLyrics] = useState(false);
	const fetchLyricsNow = async () => {
		if (!track) return;
		setFetchingLyrics(true);
		try {
			const res = await musicService.fetchLyrics(track.id);
			if (res.lyrics) setLyrics(res.lyrics);
			if ('status' in res.result && res.result.status === 'found')
				notifySuccess('Lyrics found');
			else if ('skipped' in res.result) notifySuccess(`Skipped: ${res.result.skipped}`);
			else notifyError('No lyrics found on LRCLIB');
		} catch (err) {
			notifyError((err as Error)?.message || 'Lyrics lookup failed');
		} finally {
			setFetchingLyrics(false);
		}
	};

	const saveLyrics = async () => {
		setSaving(true);
		const body = {
			plain: draftPlain.trim() ? draftPlain : null,
			syncedLrc: draftSynced.trim() ? draftSynced : null,
		};
		try {
			await musicService.saveLyrics(track.id, body);
			setLyrics({ ...body, source: 'manual' });
			setEditing(false);
			notifySuccess('Lyrics saved');
		} catch (err) {
			notifyError((err as Error)?.message || 'Failed to save lyrics');
		} finally {
			setSaving(false);
		}
	};

	const primaryArtistId = track.artists[0]?.id ?? null;
	const facts = [
		track.discNo > 1 ? `Disc ${track.discNo}` : null,
		track.trackNo ? `Track ${track.trackNo}` : null,
		formatDuration(track.durationSeconds),
		track.playCount ? `${track.playCount} plays` : null,
	].filter(Boolean) as string[];

	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={`${styles.artWrap} ${styles.artWrapSmall}`}>
						<InlineLink href={`/album/${track.albumId}`} class={styles.artLink}>
							<SmartImage
								src={track.artUrl}
								alt={track.albumTitle}
								class={styles.art}
								imgClass={styles.art}
								fallbackLabel={track.title}
							/>
						</InlineLink>
					</div>
					<div class={styles.heroInfo}>
						<span class={styles.kicker}>Track</span>
						<h1 class={styles.title}>{track.title}</h1>
						<div class={styles.byline}>
							{track.artists.length > 0 ? (
								<ArtistLinks artists={track.artists} class={styles.link} />
							) : (
								track.artistCredit
							)}
						</div>
						<div class={styles.facts}>
							<span>
								<InlineLink href={`/album/${track.albumId}`} class={styles.link}>
									{track.albumTitle}
								</InlineLink>
							</span>
							{facts.map((f) => (
								<span key={f}>{f}</span>
							))}
						</div>
						<div class={styles.ratingRow}>
							<EntityRating
								entity={{ type: 'track', id: track.id }}
								initialUserRating={track.userRating ?? null}
							/>
							<FavoriteButton entityType="track" entityId={track.id} size="large" />
						</div>
						<div class={styles.actions}>
							<Button onClick={() => playMusic({ type: 'track', id: track.id })}>
								<span class={styles.btnIcon}>
									<Icon name="play" size={16} /> Play
								</span>
							</Button>
							<EntityOptionsMenu
								entity={{ type: 'track', id: track.id }}
								item={trackQueueItem(track)}
								albumId={track.albumId}
								artistId={primaryArtistId}
								actions={[
									'playNext',
									'addToQueue',
									'playlist',
									'favorite',
									'goAlbum',
									'goArtist',
									'download',
								]}
							/>
						</div>
					</div>
				</header>

				<section class={styles.section}>
					<div class={styles.lyricsHeader}>
						<h2 class={styles.sectionTitle}>Lyrics</h2>
						{canEdit && !editing && (
							<span class={styles.btnIcon}>
								<Button
									variant="ghost"
									size="sm"
									loading={fetchingLyrics}
									onClick={fetchLyricsNow}
									title="Look up lyrics on LRCLIB (never replaces lyrics edited by hand)"
								>
									<span class={styles.btnIcon}>
										<Icon name="download" size={14} /> Fetch
									</span>
								</Button>
								<Button variant="ghost" size="sm" onClick={startEdit}>
									<span class={styles.btnIcon}>
										<Icon name="edit" size={14} /> Edit
									</span>
								</Button>
							</span>
						)}
					</div>
					{editing ? (
						<div class={styles.lyricsEditor}>
							<label>
								Plain lyrics
								<textarea
									value={draftPlain}
									onInput={(e) =>
										setDraftPlain((e.target as HTMLTextAreaElement).value)
									}
								/>
							</label>
							<label>
								Synced lyrics (LRC)
								<textarea
									value={draftSynced}
									placeholder="[00:12.00] First line…"
									onInput={(e) =>
										setDraftSynced((e.target as HTMLTextAreaElement).value)
									}
								/>
							</label>
							<div class={styles.editorActions}>
								<Button
									variant="ghost"
									onClick={() => setEditing(false)}
									disabled={saving}
								>
									Cancel
								</Button>
								<Button onClick={saveLyrics} loading={saving}>
									Save
								</Button>
							</div>
						</div>
					) : syncedLines && syncedLines.length > 0 ? (
						<div>
							{syncedLines.map((l, i) => (
								<div key={i} class={styles.lyricLine}>
									<span class={styles.lyricTime}>{l.time ?? ''}</span>
									<span>{l.text || ' '}</span>
								</div>
							))}
						</div>
					) : lyrics?.plain ? (
						<p class={styles.lyrics}>{lyrics.plain}</p>
					) : (
						<p class={styles.muted}>No lyrics</p>
					)}
					{!editing && lyrics?.source && (lyrics.plain || lyrics.syncedLrc) && (
						<div class={styles.lyricsSource}>Source: {lyrics.source}</div>
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

				{track.files.length > 0 && (
					<section class={styles.section}>
						<h2 class={styles.sectionTitle}>File info</h2>
						<div class={styles.tableWrap}>
							<table class={styles.table}>
								<thead>
									<tr>
										<th>Format</th>
										<th>Codec</th>
										<th>Bitrate</th>
										<th>Sample rate</th>
										<th>Bit depth</th>
										<th>Ch</th>
										<th>Size</th>
										<th>File</th>
									</tr>
								</thead>
								<tbody>
									{track.files.map((f) => (
										<tr key={f.id}>
											<td>
												{f.container?.toUpperCase() ?? '—'}{' '}
												{f.lossless && (
													<span class={styles.badge}>Lossless</span>
												)}
											</td>
											<td>{f.codec ?? '—'}</td>
											<td>{formatBitrate(f.bitrate)}</td>
											<td>{formatSampleRate(f.sampleRate)}</td>
											<td>{f.bitDepth ? `${f.bitDepth}-bit` : '—'}</td>
											<td>{f.channels ?? '—'}</td>
											<td>{formatFileSize(f.fileSize)}</td>
											<td class={styles.fileName} title={f.fileName}>
												{f.fileName}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				)}

				{track.appearsOn.length > 0 && (
					<MusicRail title="Appears on">
						{track.appearsOn.map((a) => (
							<AlbumCard key={a.id} album={a} />
						))}
					</MusicRail>
				)}

				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Comments</h2>
					<CommentsPanel entity={{ type: 'track', id: track.id }} />
				</section>
			</div>
		</div>
	);
}

function TrackSkeleton() {
	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div
						class={`${styles.artWrap} ${styles.artWrapSmall} ${styles.skeletonBlock}`}
					/>
					<div class={styles.heroInfo}>
						<div class={`${styles.skeletonLine} ${styles.skeletonLineLarge}`} />
						<div class={styles.skeletonLine} />
						<div class={styles.skeletonLine} />
					</div>
				</header>
			</div>
		</div>
	);
}

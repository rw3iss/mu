import type { TrackDetail } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { musicService } from '@/services/music.service';
import { minimizePlayer } from '@/state/globalPlayer.state';
import { currentTrack } from '@/state/musicPlayer.state';
import { formatBitrate, formatDuration, formatFileSize, formatSampleRate } from '@/utils/music';
import { artAtSize } from '@/utils/music-art';
import styles from '../InfoPanel.module.scss';
import own from './TrackInfoPanel.module.scss';

const detailCache = new Map<string, Promise<TrackDetail | null>>();

function loadDetail(id: string): Promise<TrackDetail | null> {
	let p = detailCache.get(id);
	if (!p) {
		p = musicService.track(id).catch(() => null);
		detailCache.set(id, p);
	}
	return p;
}

/**
 * Track info flyout for the music player (the audio counterpart of the movie
 * InfoPanel): art, title, artists, album, credits and the file being played.
 */
export function TrackInfoPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
	const now = currentTrack.value;
	const id = now?.track.id ?? null;
	const [detail, setDetail] = useState<TrackDetail | null>(null);

	useEffect(() => {
		setDetail(null);
		if (!id || !visible) return;
		let cancelled = false;
		loadDetail(id).then((d) => !cancelled && setDetail(d));
		return () => {
			cancelled = true;
		};
	}, [id, visible]);

	if (!now) return null;
	const t = detail ?? now.track;
	const go = (href: string) => {
		onClose();
		minimizePlayer();
		route(href);
	};
	const playing =
		detail?.files.find((f) => f.id === now.session?.trackFileId) ?? detail?.files[0];
	const art = artAtSize(now.artUrl, 600);

	return (
		<>
			{visible && <div class={styles.backdrop} onClick={onClose} />}
			<div class={`${styles.panel} ${visible ? styles.open : ''}`} data-player-panel>
				<button class={styles.closeBtn} onClick={onClose} aria-label="Close info">
					<Icon name="x" />
				</button>
				{art && <img class={own.art} src={art} alt="" />}
				<div class={styles.titleRow}>
					<h2
						class={`${styles.title} ${styles.titleLink}`}
						onClick={() => go(`/track/${t.id}`)}
					>
						{t.title}
					</h2>
					<FavoriteButton entityType="track" entityId={t.id} />
				</div>
				<div class={own.lines}>
					{t.artists.length > 0 ? (
						<div>
							{t.artists.map((a, i) => (
								<span key={a.id}>
									{i > 0 && ', '}
									<a
										class={styles.directorLink}
										onClick={() => go(`/artist/${a.id}`)}
									>
										{a.name}
									</a>
								</span>
							))}
						</div>
					) : (
						t.artistCredit && <div>{t.artistCredit}</div>
					)}
					<div>
						<a class={styles.directorLink} onClick={() => go(`/album/${t.albumId}`)}>
							{t.albumTitle}
						</a>
						{t.trackNo != null && ` · track ${t.trackNo}`}
						{t.durationSeconds != null && ` · ${formatDuration(t.durationSeconds)}`}
					</div>
				</div>

				{detail && detail.credits.length > 0 && (
					<section class={own.section}>
						<h3 class={own.heading}>Credits</h3>
						{detail.credits.map((c) => (
							<div key={`${c.artistId}:${c.role}`} class={own.kv}>
								<span>{c.role}</span>
								<a
									class={styles.directorLink}
									onClick={() => go(`/artist/${c.artistId}`)}
								>
									{c.name}
								</a>
							</div>
						))}
					</section>
				)}

				{playing && (
					<section class={own.section}>
						<h3 class={own.heading}>File</h3>
						<div class={own.kv}>
							<span>Format</span>
							<span>
								{[
									playing.codec?.toUpperCase(),
									playing.lossless ? 'lossless' : null,
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
						</div>
						<div class={own.kv}>
							<span>Quality</span>
							<span>
								{[
									playing.bitDepth ? `${playing.bitDepth}-bit` : null,
									formatSampleRate(playing.sampleRate),
									formatBitrate(playing.bitrate),
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
						</div>
						<div class={own.kv}>
							<span>Streaming</span>
							<span>
								{now.session
									? now.session.original
										? 'Original file'
										: `${now.session.profile} (${now.session.codec ?? 'transcode'})`
									: '—'}
							</span>
						</div>
						<div class={own.kv}>
							<span>Size</span>
							<span>{formatFileSize(playing.fileSize)}</span>
						</div>
						<div class={own.file} title={playing.fileName}>
							{playing.fileName}
						</div>
					</section>
				)}
			</div>
		</>
	);
}

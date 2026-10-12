import type { MusicSharePayload, TrackSummary } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Spinner';
import { useSeo } from '@/hooks/useSeo';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { musicShareService } from '@/services/music.service';
import { currentTrack, stopMusic } from '@/state/musicPlayer.state';
import { listenToken } from '@/state/share.state';
import { formatDuration, playTracksFrom, shuffleTracks } from '@/utils/music';
import { artAtSize } from '@/utils/music-art';
import styles from './PublicListen.module.scss';

interface PublicListenProps {
	path?: string;
	token?: string;
}

/** Per-device music keys a shared session must not overwrite for a logged-in owner. */
const PRESERVED_KEYS = ['play_queue_audio', 'play_queue_audio_repeat', 'play_queue_audio_shuffle'];

const KIND_LABEL = {
	track: 'Track',
	album: 'Album',
	playlist: 'Playlist',
	queue: 'Queue',
} as const;

/**
 * Public route `/listen/:token` — anonymous playback of a shared track,
 * album, playlist or queue in the Mu music player. The token is installed
 * for this page's lifetime only: the player and musicService use the token's
 * public routes while it is set, and the visitor's own queue (if they also
 * use Mu in this browser) is put back when they leave.
 */
export function PublicListen({ token }: PublicListenProps) {
	const [share, setShare] = useState<MusicSharePayload | null>(null);
	const [error, setError] = useState<string | null>(null);

	useSeo({
		title: share ? `Listen: ${share.title}` : 'Listen',
		description: 'Music shared from a private Mu library.',
		image: share?.artUrl ?? undefined,
		robots: 'noindex,follow',
	});

	useEffect(() => {
		if (!token) {
			setError('Missing share link.');
			return;
		}
		const saved = PRESERVED_KEYS.map((k) => [k, getUiSetting<unknown>(k, null)] as const);
		const restore = () => {
			for (const [k, v] of saved) if (v !== null) setUiSetting(k, v);
		};
		listenToken.value = token;
		window.addEventListener('pagehide', restore);
		musicShareService
			.payload(token)
			.then(setShare)
			.catch((err) => {
				const status = (err as { status?: number })?.status;
				setError(
					status === 410
						? 'This share link has expired.'
						: 'This share link is invalid or has been removed.',
				);
			});
		return () => {
			stopMusic();
			listenToken.value = null;
			window.removeEventListener('pagehide', restore);
			restore();
		};
	}, [token]);

	if (error) {
		return (
			<div class={styles.center}>
				<Icon name="music" size={32} />
				<p class={styles.error}>{error}</p>
			</div>
		);
	}
	if (!share) {
		return (
			<div class={styles.center}>
				<Spinner size="lg" />
			</div>
		);
	}

	const context = { type: 'playlist' as const, id: null, title: share.title };
	const playing = currentTrack.value?.track.id;
	const play = (i: number) => void playTracksFrom(share.tracks, i, context);
	const total = share.tracks.reduce((s, t) => s + (t.durationSeconds ?? 0), 0);

	return (
		<div class={styles.page}>
			{share.artUrl && (
				<div
					class={styles.backdrop}
					style={{ backgroundImage: `url("${artAtSize(share.artUrl, 256)}")` }}
				/>
			)}
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={styles.art}>
						{share.artUrl ? (
							<img src={artAtSize(share.artUrl, 600) ?? ''} alt="" />
						) : (
							<Icon name="music" size={48} />
						)}
					</div>
					<div class={styles.heroInfo}>
						<span class={styles.kicker}>Shared {KIND_LABEL[share.kind]}</span>
						<h1 class={styles.title}>{share.title}</h1>
						<span class={styles.meta}>
							{[
								`${share.tracks.length} track${share.tracks.length === 1 ? '' : 's'}`,
								total ? formatDuration(total) : null,
								share.expiresAt
									? `link expires ${new Date(share.expiresAt).toLocaleDateString()}`
									: null,
							]
								.filter(Boolean)
								.join(' · ')}
						</span>
						<div class={styles.actions}>
							<Button onClick={() => play(0)} disabled={share.tracks.length === 0}>
								<Icon name="play" size={16} /> Play
							</Button>
							{share.tracks.length > 1 && (
								<Button
									variant="secondary"
									onClick={() => void shuffleTracks(share.tracks, context)}
								>
									<Icon name="shuffle" size={16} /> Shuffle
								</Button>
							)}
						</div>
					</div>
				</header>

				{share.tracks.length === 0 ? (
					<p class={styles.muted}>Nothing to play — the shared items were removed.</p>
				) : (
					<ol class={styles.list}>
						{share.tracks.map((t: TrackSummary, i) => (
							<li key={t.id}>
								<button
									type="button"
									class={`${styles.row} ${playing === t.id ? styles.rowActive : ''}`}
									onClick={() => play(i)}
								>
									<span class={styles.num}>
										{playing === t.id ? <Icon name="music" size={14} /> : i + 1}
									</span>
									{share.kind !== 'album' && (
										<span class={styles.thumb}>
											{t.artUrl && (
												<img src={artAtSize(t.artUrl, 64) ?? ''} alt="" />
											)}
										</span>
									)}
									<span class={styles.rowText}>
										<span class={styles.rowTitle}>{t.title}</span>
										<span class={styles.rowSub}>
											{[
												t.artistCredit,
												share.kind === 'album' ? null : t.albumTitle,
											]
												.filter(Boolean)
												.join(' · ')}
										</span>
									</span>
									<span class={styles.duration}>
										{formatDuration(t.durationSeconds)}
									</span>
								</button>
							</li>
						))}
					</ol>
				)}
				<p class={styles.footer}>Shared from a private Mu library.</p>
			</div>
		</div>
	);
}

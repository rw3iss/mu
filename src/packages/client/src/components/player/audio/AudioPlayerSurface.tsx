import type { VNode } from 'preact';
import { useEffect } from 'preact/hooks';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getUiSetting } from '@/hooks/useUiSetting';
import {
	closePlayer,
	maximizePlayer,
	minimizePlayer,
	playerMode,
	splitPlayer,
	splitWidth,
} from '@/state/globalPlayer.state';
import {
	currentTrack,
	musicPanelOpen,
	next,
	previous,
	seekAudio,
	skipAudio,
	toggleAudioPlay,
} from '@/state/musicPlayer.state';
import { currentTime, duration, isBuffering, isPlaying } from '@/state/player.state';
import { artAtSize } from '@/utils/music-art';
import { openMusicLink } from '../controls/TrackTitle';
import { EffectsPanel } from '../EffectsPanel';
import gp from '../GlobalPlayer.module.scss';
import { PlayerControls } from '../PlayerControls';
import styles from './AudioPlayerSurface.module.scss';
import { MusicListPanel } from './MusicListPanel';

let splitWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
function setSplitWidth(w: number) {
	splitWidth.value = w;
	if (splitWidthSaveTimer) clearTimeout(splitWidthSaveTimer);
	splitWidthSaveTimer = setTimeout(() => {
		localStorage.setItem('mu_ui_split_width', String(w));
		splitWidthSaveTimer = null;
	}, 200);
}

function onSplitDrag(e: MouseEvent) {
	e.preventDefault();
	const startX = e.clientX;
	const startWidth = splitWidth.value;
	const onMove = (ev: MouseEvent) => {
		const delta = startX - ev.clientX;
		const w = Math.min(62, Math.max(25, startWidth + (delta / window.innerWidth) * 100));
		setSplitWidth(Math.round(w));
	};
	const onUp = () => {
		document.removeEventListener('mousemove', onMove);
		document.removeEventListener('mouseup', onUp);
	};
	document.addEventListener('mousemove', onMove);
	document.addEventListener('mouseup', onUp);
}

/** Album art (or a note placeholder) at a given size. */
function Artwork({ size, class: cls }: { size: number; class?: string }) {
	const src = artAtSize(currentTrack.value?.artUrl, size);
	return (
		<div class={`${styles.artwork} ${cls ?? ''}`}>
			{src ? (
				<img src={src} alt="" draggable={false} />
			) : (
				<svg class={styles.artPlaceholder} viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
				</svg>
			)}
			{isBuffering.value && (
				<div class={styles.artSpinner}>
					<div class={gp.loadingSpinnerIcon} />
				</div>
			)}
		</div>
	);
}

/** Title / artist(s) / album, each linking to its page. */
function NowPlayingText({ compact }: { compact?: boolean }) {
	const t = currentTrack.value?.track;
	if (!t) return null;
	return (
		<div class={`${styles.text} ${compact ? styles.textCompact : ''}`}>
			<a
				href={`/track/${t.id}`}
				class={styles.trackName}
				onClick={(e) => openMusicLink(`/track/${t.id}`, e)}
			>
				{t.title}
			</a>
			<div class={styles.artistLine}>
				{t.artists.length > 0
					? t.artists
							.filter((a) => a.role !== 'featured' || t.artists.length === 1)
							.map((a, i) => (
								<span key={a.id}>
									{i > 0 && ', '}
									<a
										href={`/artist/${a.id}`}
										onClick={(e) => openMusicLink(`/artist/${a.id}`, e)}
									>
										{a.name}
									</a>
								</span>
							))
					: t.artistCredit || 'Unknown artist'}
			</div>
			<a
				href={`/album/${t.albumId}`}
				class={styles.albumName}
				onClick={(e) => openMusicLink(`/album/${t.albumId}`, e)}
			>
				{t.albumTitle}
			</a>
		</div>
	);
}

function PlayPauseIcon({ size = 22 }: { size?: number }) {
	return isPlaying.value ? (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="white">
			<rect x="6" y="4" width="4" height="16" rx="1" />
			<rect x="14" y="4" width="4" height="16" rx="1" />
		</svg>
	) : (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="white">
			<path d="M8 5v14l11-7z" />
		</svg>
	);
}

/** Thin ring around the mini art showing track progress. */
function ProgressRing() {
	const r = 46;
	const c = 2 * Math.PI * r;
	const p = duration.value > 0 ? Math.min(1, currentTime.value / duration.value) : 0;
	return (
		<svg class={styles.ring} viewBox="0 0 100 100" aria-hidden="true">
			<circle class={styles.ringTrack} cx="50" cy="50" r={r} />
			<circle
				class={styles.ringFill}
				cx="50"
				cy="50"
				r={r}
				stroke-dasharray={c}
				stroke-dashoffset={c * (1 - p)}
			/>
		</svg>
	);
}

const ICON = {
	minimize: <polyline points="6 9 12 15 18 9" />,
	maximize: (
		<>
			<polyline points="15 3 21 3 21 9" />
			<polyline points="9 21 3 21 3 15" />
			<line x1="21" y1="3" x2="14" y2="10" />
			<line x1="3" y1="21" x2="10" y2="14" />
		</>
	),
	split: (
		<>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<line x1="12" y1="3" x2="12" y2="21" />
		</>
	),
	list: (
		<>
			<line x1="8" y1="6" x2="21" y2="6" />
			<line x1="8" y1="12" x2="21" y2="12" />
			<line x1="8" y1="18" x2="21" y2="18" />
			<line x1="3" y1="6" x2="3.01" y2="6" />
			<line x1="3" y1="12" x2="3.01" y2="12" />
			<line x1="3" y1="18" x2="3.01" y2="18" />
		</>
	),
	close: (
		<>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</>
	),
};

function TopIcon({ name }: { name: keyof typeof ICON }) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			{ICON[name]}
		</svg>
	);
}

/**
 * The music body of the player shell: artwork instead of video, in the same
 * mini / full / split modes. Rendered by GlobalPlayer when activeKind is
 * 'audio'; the video layout is untouched.
 */
export function AudioPlayerSurface() {
	const mode = playerMode.value;
	const isMini = mode === 'mini';
	const isSplit = mode === 'split';
	const isPortraitSplit = useMediaQuery('(max-width: 767px) and (orientation: portrait)');

	// Keyboard: space play/pause, ←/→ seek, Shift+←/→ previous/next track,
	// Escape/Backspace minimises from full.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				e.target instanceof HTMLSelectElement ||
				(e.target as HTMLElement)?.isContentEditable
			) {
				return;
			}
			if (playerMode.value === 'hidden') return;
			if (e.key === ' ') {
				e.preventDefault();
				toggleAudioPlay();
			} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				if (e.shiftKey) {
					void (e.key === 'ArrowLeft' ? previous() : next());
					return;
				}
				const step = getUiSetting<number[]>('skip_times', [5, 10, 20])[0] ?? 5;
				skipAudio(e.key === 'ArrowLeft' ? -step : step);
			} else if (e.key === 'Escape' || e.key === 'Backspace') {
				if (playerMode.value !== 'full') return;
				e.preventDefault();
				minimizePlayer();
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, []);

	const t = currentTrack.value?.track;
	const controls = (extra: {
		hasMiniThumbnail?: boolean;
		isSplit?: boolean;
		leftSlot?: VNode | null;
	}) => (
		<PlayerControls
			visible
			onTogglePlay={toggleAudioPlay}
			onSeek={seekAudio}
			onToggleFullscreen={() => (isMini ? maximizePlayer() : minimizePlayer())}
			onToggleInfo={() => {}}
			session={null}
			title={t?.title}
			playbackLocked={false}
			{...extra}
		/>
	);

	if (isMini) {
		return (
			<>
				<div
					class={styles.miniArt}
					onClick={maximizePlayer}
					title="Expand player"
					role="button"
					tabIndex={-1}
				>
					<Artwork size={256} />
					<ProgressRing />
					<button
						type="button"
						class={styles.miniPlay}
						onClick={(e) => {
							e.stopPropagation();
							toggleAudioPlay();
						}}
						aria-label={isPlaying.value ? 'Pause' : 'Play'}
					>
						<PlayPauseIcon size={26} />
					</button>
				</div>
				<div class={`${gp.playerBar} ${gp.playerBarMini}`}>
					{controls({
						hasMiniThumbnail: true,
						leftSlot: <div class={styles.miniSpacer} />,
					})}
				</div>
				<EffectsPanel />
			</>
		);
	}

	if (isSplit) {
		return (
			<div
				class={`${gp.splitPanel} ${isPortraitSplit ? gp.splitPanelPortrait : ''} ${styles.split}`}
				style={isPortraitSplit ? undefined : { width: `${splitWidth.value}vw` }}
			>
				<div class={gp.splitDragHandle} onMouseDown={onSplitDrag} />
				<div class={gp.splitTopBar}>
					<button
						class={gp.splitTopBtn}
						onClick={() => minimizePlayer()}
						title="Minimize"
					>
						<TopIcon name="minimize" />
					</button>
					<button
						class={gp.splitTopBtn}
						onClick={() => maximizePlayer()}
						title="Full screen"
					>
						<TopIcon name="maximize" />
					</button>
					<div style={{ flex: 1 }} />
					<button class={gp.splitTopBtn} onClick={() => closePlayer()} title="Close">
						<TopIcon name="close" />
					</button>
				</div>
				<div class={styles.splitNowPlaying}>
					<Artwork size={256} class={styles.splitArt} />
					<NowPlayingText compact />
				</div>
				{controls({ isSplit: true })}
				<div class={styles.splitList}>
					<MusicListPanel variant="split" />
				</div>
				<EffectsPanel />
			</div>
		);
	}

	// Full
	const backdrop = artAtSize(currentTrack.value?.artUrl, 256);
	return (
		<>
			<div class={styles.full}>
				{backdrop && (
					<div
						class={styles.backdrop}
						style={{ backgroundImage: `url("${backdrop}")` }}
					/>
				)}
				<div class={styles.fullTop}>
					<button
						class={styles.topBtn}
						onClick={minimizePlayer}
						title="Minimize"
						aria-label="Minimize player"
					>
						<TopIcon name="minimize" />
					</button>
					<button
						class={styles.topBtn}
						onClick={splitPlayer}
						title="Split view"
						aria-label="Split view"
					>
						<TopIcon name="split" />
					</button>
					<div style={{ flex: 1 }} />
					<button
						class={`${styles.topBtn} ${musicPanelOpen.value ? styles.topBtnActive : ''}`}
						onClick={() => {
							musicPanelOpen.value = !musicPanelOpen.value;
						}}
						title={musicPanelOpen.value ? 'Hide list' : 'Show list'}
						aria-label="Toggle list panel"
					>
						<TopIcon name="list" />
					</button>
					<button
						class={styles.topBtn}
						onClick={closePlayer}
						title="Close"
						aria-label="Close player"
					>
						<TopIcon name="close" />
					</button>
				</div>
				<div class={styles.stage}>
					<div class={styles.nowPlaying}>
						<Artwork size={600} class={styles.bigArt} />
						<NowPlayingText />
					</div>
					{musicPanelOpen.value && (
						<aside class={styles.sidePanel}>
							<MusicListPanel
								variant="side"
								onClose={() => {
									musicPanelOpen.value = false;
								}}
							/>
						</aside>
					)}
				</div>
			</div>
			<div class={`${gp.playerBar} ${gp.playerBarFull}`}>{controls({})}</div>
			<EffectsPanel />
		</>
	);
}

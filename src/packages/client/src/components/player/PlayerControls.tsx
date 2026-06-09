import type { VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import { SubtitleAppearance } from '@/components/movie/SubtitleAppearance';
import { SubtitlePanel } from '@/components/movie/SubtitlePanel';
import { getUiSetting, useUiSetting } from '@/hooks/useUiSetting';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { subtitlesService } from '@/services/subtitles.service';
import {
	compressorEnabled,
	eqEnabled,
	showEffectsPanel,
	toggleEffectsPanel,
	videoEnabled,
} from '@/state/audio-effects.state';
import { globalMovie, globalMovieId, minimizePlayer, playerMode } from '@/state/globalPlayer.state';
import type { StreamSession } from '@/state/player.state';
import {
	audioTrack,
	currentSession,
	currentTime,
	duration,
	isFullscreen,
	isMuted,
	isPlaying,
	quality,
	saveAudioTrackChoice,
	saveSubtitleChoice,
	setVolume,
	spriteMeta,
	subtitleTrack,
	toggleMute,
	volume,
} from '@/state/player.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { shareMode } from '@/state/share.state';
import { shareLinksService } from '@/services/share-links.service';
import { VolumeControl, VolumeIcon } from './controls/VolumeControl';
import styles from './PlayerControls.module.scss';

interface PlayerControlsProps {
	visible: boolean;
	onTogglePlay: () => void;
	onSeek: (time: number) => void;
	onToggleFullscreen: () => void;
	onToggleInfo: () => void;
	session: StreamSession | null;
	title?: string;
	/** When true, fullscreen button shows maximize icon instead */
	hasMiniThumbnail?: boolean;
	/** Element rendered to the left of the controls row, below the seek bar */
	leftSlot?: VNode | null;
	/** When true, renders in compact split-panel layout */
	isSplit?: boolean;
}

function SubtitleSettingsCollapsible() {
	const [open, setOpen] = useUiSetting('subtitle_settings_panel_open', false);
	return (
		<div>
			<button
				class={styles.menuItem}
				onClick={() => setOpen(!open)}
				style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
			>
				<span>Settings</span>
				<span style={{ display: 'inline-flex', color: 'rgba(255,255,255,0.5)' }}>
					<Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
				</span>
			</button>
			{open && (
				<div style={{ padding: '8px 12px' }}>
					<SubtitleAppearance compact />
				</div>
			)}
		</div>
	);
}

/**
 * Render the seek-bar sprite preview tooltip into document.body via
 * createPortal. Bypasses the player bar's backdrop-filter stacking
 * context (which would otherwise paint the tooltip below the
 * fixed-position video on some browser/composition paths) and pins
 * positioning to viewport coordinates derived from the live
 * `seekBarRect`. Returns null until both a hover position AND sprite
 * meta are available.
 *
 * Z-index is computed against `--z-player-controls` so themes /
 * future scale changes carry through automatically.
 */
function renderSpritePortal(args: {
	seekHover: number | null;
	seekBarRect: { left: number; top: number; width: number } | null;
	seekHoverX: number;
	meta: import('@/state/player.state').SpriteMeta | null;
	movieId: string | null;
}) {
	const { seekHover, seekBarRect, seekHoverX, meta, movieId } = args;
	if (
		seekHover === null ||
		!seekBarRect ||
		!meta ||
		!movieId ||
		typeof document === 'undefined'
	) {
		return null;
	}
	// Cursor X in viewport coords = bar's left + cursor offset within bar.
	const cursorX = seekBarRect.left + seekHoverX;

	// Sprite math
	const frameIndex = Math.min(
		Math.floor(seekHover / meta.interval),
		meta.totalFrames - 1,
	);
	const framesPerSheet = meta.columns * meta.rows;
	const sheetIndex = Math.floor(frameIndex / framesPerSheet);
	const frameInSheet = frameIndex % framesPerSheet;
	const col = frameInSheet % meta.columns;
	const row = Math.floor(frameInSheet / meta.columns);
	const bgX = -(col * meta.frameWidth);
	const bgY = -(row * meta.frameHeight);

	// Position the tooltip 14px above the seek bar's top, centered on
	// the cursor. Clamp horizontally to the viewport so the tooltip
	// never overflows the screen edge.
	const tooltipWidth = meta.frameWidth + 4;
	const halfWidth = tooltipWidth / 2;
	const viewportWidth = window.innerWidth;
	const clampedX = Math.max(halfWidth, Math.min(cursorX, viewportWidth - halfWidth));
	const top = seekBarRect.top - meta.frameHeight - 28;

	// Size-aware corner rounding. Formula: 5 + (level * 2)px, where
	// level = 1 (small) … 4 (xlarge). Scales gently with the sheet
	// dimensions so a small thumbnail looks tasteful and a 480px
	// xlarge gets a more noticeable, comfortable curve.
	const sizeLevel: Record<string, number> = { small: 1, medium: 2, large: 3, xlarge: 4 };
	const level = sizeLevel[meta.size ?? 'large'] ?? 3;
	const cornerRadiusPx = 5 + level * 2;

	return createPortal(
		<div
			style={{
				position: 'fixed',
				left: `${clampedX}px`,
				top: `${top}px`,
				transform: 'translateX(-50%)',
				pointerEvents: 'none',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				zIndex: 2147483647,
			}}
		>
			<div
				style={{
					width: `${meta.frameWidth}px`,
					height: `${meta.frameHeight}px`,
					border: '2px solid rgba(255,255,255,0.9)',
					borderRadius: `${cornerRadiusPx}px`,
					boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
					backgroundColor: '#000',
					backgroundRepeat: 'no-repeat',
					backgroundImage: `url(/api/v1/media/sprites/${movieId}/${sheetIndex}.jpg?size=${encodeURIComponent(meta.size ?? 'large')})`,
					backgroundPosition: `${bgX}px ${bgY}px`,
					backgroundSize: `${meta.frameWidth * meta.columns}px ${meta.frameHeight * meta.rows}px`,
					// Clip the sprite to the rounded border so corners
					// render cleanly even when the bitmap fills the box.
					backgroundClip: 'padding-box',
					overflow: 'hidden',
				}}
			/>
			<span
				style={{
					marginTop: '4px',
					background: 'rgba(0, 0, 0, 0.85)',
					color: '#fff',
					fontSize: '11px',
					fontVariantNumeric: 'tabular-nums',
					padding: '1px 6px',
					borderRadius: '3px',
					whiteSpace: 'nowrap',
				}}
			>
				{formatTime(seekHover)}
			</span>
		</div>,
		document.body,
	);
}

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	if (h > 0) {
		return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}
	return `${m}:${s.toString().padStart(2, '0')}`;
}

const DRAG_THROTTLE_MS = 15;

export function PlayerControls({
	visible,
	onTogglePlay,
	onSeek,
	onToggleFullscreen,
	onToggleInfo,
	session,
	title,
	hasMiniThumbnail,
	leftSlot,
	isSplit,
}: PlayerControlsProps) {
	const [showSettingsMenu, setShowSettingsMenu] = useState(false);
	const [settingsPanel, setSettingsPanel] = useState<
		'main' | 'quality' | 'subtitles' | 'subtitle-manage' | 'audio'
	>('main');
	const [seekHover, setSeekHover] = useState<number | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [skipBackOpen, setSkipBackOpen] = useState(false);
	const [skipFwdOpen, setSkipFwdOpen] = useState(false);
	const [showMobileOverflow, setShowMobileOverflow] = useState(false);
	const [isMobile, setIsMobile] = useState(
		() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
	);
	const seekBarRef = useRef<HTMLDivElement>(null);
	const settingsRef = useRef<HTMLDivElement>(null);
	const mobileOverflowRef = useRef<HTMLDivElement>(null);
	const dragLastSeek = useRef<number>(0);
	/** Auto-hide timers for the mobile skip-extended overlays. Reset on
	 * each interaction, default 3s, configurable via the
	 * `skip_autohide_ms` UI setting. Desktop ignores these — it uses
	 * mouseenter/mouseleave to drive open/close. */
	const skipBackHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const skipFwdHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const SKIP_AUTOHIDE_MS = getUiSetting<number>('skip_autohide_ms', 3000);

	// Track viewport size so the skip-extended overlays know whether to
	// behave as click-toggle (mobile) or hover (desktop).
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(max-width: 767px)');
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, []);

	// Schedule auto-close of the skip-back overlay (mobile only). Called
	// when the overlay opens and again on every skip-back-time tap to
	// reset the countdown.
	const armSkipBackAutoHide = useCallback(() => {
		if (skipBackHideTimer.current) clearTimeout(skipBackHideTimer.current);
		if (!isMobile) return;
		skipBackHideTimer.current = setTimeout(() => {
			setSkipBackOpen(false);
			skipBackHideTimer.current = null;
		}, SKIP_AUTOHIDE_MS);
	}, [isMobile, SKIP_AUTOHIDE_MS]);

	const armSkipFwdAutoHide = useCallback(() => {
		if (skipFwdHideTimer.current) clearTimeout(skipFwdHideTimer.current);
		if (!isMobile) return;
		skipFwdHideTimer.current = setTimeout(() => {
			setSkipFwdOpen(false);
			skipFwdHideTimer.current = null;
		}, SKIP_AUTOHIDE_MS);
	}, [isMobile, SKIP_AUTOHIDE_MS]);

	// Clean up auto-hide timers on unmount.
	useEffect(() => {
		return () => {
			if (skipBackHideTimer.current) clearTimeout(skipBackHideTimer.current);
			if (skipFwdHideTimer.current) clearTimeout(skipFwdHideTimer.current);
		};
	}, []);

	const progress = duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0;

	// Close settings on outside click
	useEffect(() => {
		if (!showSettingsMenu) return;
		function handleClick(e: MouseEvent) {
			if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
				setShowSettingsMenu(false);
				setSettingsPanel('main');
			}
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [showSettingsMenu]);

	// Close mobile overflow on outside click
	useEffect(() => {
		if (!showMobileOverflow) return;
		function handleClick(e: MouseEvent) {
			if (
				mobileOverflowRef.current &&
				!mobileOverflowRef.current.contains(e.target as Node)
			) {
				setShowMobileOverflow(false);
			}
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [showMobileOverflow]);

	// ── Seek bar: click ──
	const seekFromEvent = useCallback((e: MouseEvent) => {
		const bar = seekBarRef.current;
		if (!bar) return;
		const rect = bar.getBoundingClientRect();
		const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		return fraction * duration.value;
	}, []);

	// ── Seek bar: right-click → "Copy URL at Time" (public/private share) ──
	const [shareMenu, setShareMenu] = useState<{ x: number; y: number; time: number } | null>(null);
	const [shareBusy, setShareBusy] = useState(false);

	const handleSeekContext = useCallback(
		(e: MouseEvent) => {
			// Public viewers (share mode) can't mint share links — skip the menu.
			if (shareMode.value) return;
			const time = seekFromEvent(e);
			if (time == null) return;
			e.preventDefault();
			setShareMenu({ x: e.clientX, y: e.clientY, time: Math.max(0, Math.floor(time)) });
		},
		[seekFromEvent],
	);

	const copyShareAtTime = useCallback(
		async (kind: 'public' | 'private') => {
			const menu = shareMenu;
			const movieId = globalMovieId.value;
			if (!menu || !movieId) return;
			setShareBusy(true);
			try {
				let url: string;
				if (kind === 'public') {
					const { token } = await shareLinksService.create(movieId);
					url = `${shareLinksService.buildUrl(token)}?t=${menu.time}`;
				} else {
					url = `${window.location.origin}/movie/${movieId}?t=${menu.time}`;
				}
				await navigator.clipboard.writeText(url);
				notifySuccess(
					`${kind === 'public' ? 'Public' : 'Private'} link copied (at ${formatTime(menu.time)})`,
				);
			} catch (err) {
				notifyError((err as Error)?.message || 'Could not copy the link');
			} finally {
				setShareBusy(false);
				setShareMenu(null);
			}
		},
		[shareMenu],
	);

	// Dismiss the share menu on outside click / Escape.
	useEffect(() => {
		if (!shareMenu) return;
		const close = () => setShareMenu(null);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setShareMenu(null);
		};
		// Defer binding so the opening contextmenu doesn't immediately self-close.
		const id = setTimeout(() => {
			document.addEventListener('mousedown', close);
			document.addEventListener('keydown', onKey);
		}, 0);
		return () => {
			clearTimeout(id);
			document.removeEventListener('mousedown', close);
			document.removeEventListener('keydown', onKey);
		};
	}, [shareMenu]);

	const handleSeekBarClick = useCallback(
		(e: MouseEvent) => {
			if (isDragging) return;
			const time = seekFromEvent(e);
			if (time !== undefined) onSeek(time);
		},
		[onSeek, seekFromEvent, isDragging],
	);

	// ── Seek bar: hover tooltip ──
	const [seekHoverX, setSeekHoverX] = useState(0);
	/**
	 * Viewport-coords bounding box of the seek bar, captured on hover.
	 * Used to position the sprite tooltip via createPortal into
	 * document.body — escapes the player bar's stacking context (which
	 * has backdrop-filter: blur, creating a new stacking root) so the
	 * tooltip reliably paints above the video.
	 */
	const [seekBarRect, setSeekBarRect] = useState<{
		left: number;
		top: number;
		width: number;
	} | null>(null);
	const handleSeekHover = useCallback((e: MouseEvent) => {
		const bar = seekBarRef.current;
		if (!bar) return;
		const rect = bar.getBoundingClientRect();
		const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		setSeekHover(fraction * duration.value);
		setSeekHoverX(e.clientX - rect.left);
		setSeekBarRect({ left: rect.left, top: rect.top, width: rect.width });
	}, []);

	// ── Seek bar: drag ──
	const handleSeekMouseDown = useCallback(
		(e: MouseEvent) => {
			e.preventDefault();
			setIsDragging(true);
			dragLastSeek.current = 0;

			const onMove = (me: MouseEvent) => {
				const now = performance.now();
				if (now - dragLastSeek.current < DRAG_THROTTLE_MS) return;
				dragLastSeek.current = now;

				const bar = seekBarRef.current;
				if (!bar) return;
				const rect = bar.getBoundingClientRect();
				const fraction = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
				onSeek(fraction * duration.value);
			};

			const onUp = (me: MouseEvent) => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				setIsDragging(false);

				const bar = seekBarRef.current;
				if (bar) {
					const rect = bar.getBoundingClientRect();
					const fraction = Math.max(
						0,
						Math.min(1, (me.clientX - rect.left) / rect.width),
					);
					onSeek(fraction * duration.value);
				}
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);

			const bar = seekBarRef.current;
			if (bar) {
				const rect = bar.getBoundingClientRect();
				const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
				onSeek(fraction * duration.value);
			}
		},
		[onSeek],
	);

	// ── Skip ──
	const skipBack = useCallback(
		(seconds: number) => {
			onSeek(Math.max(0, currentTime.value - seconds));
		},
		[onSeek],
	);

	const skipForward = useCallback(
		(seconds: number) => {
			onSeek(Math.min(duration.value, currentTime.value + seconds));
		},
		[onSeek],
	);

	// ── Settings ──
	const handleQualitySelect = useCallback((q: string) => {
		quality.value = q;
		setShowSettingsMenu(false);
		setSettingsPanel('main');
	}, []);

	const handleSubtitleSelect = useCallback((trackId: string | null) => {
		const movieId = globalMovieId.value;
		if (movieId) {
			saveSubtitleChoice(movieId, trackId);
		} else {
			subtitleTrack.value = trackId;
		}
		setShowSettingsMenu(false);
		setSettingsPanel('main');
	}, []);

	const handleAudioTrackSelect = useCallback((trackId: string) => {
		const movieId = globalMovieId.value;
		if (movieId) {
			saveAudioTrackChoice(movieId, trackId);
		} else {
			audioTrack.value = trackId;
		}
		setShowSettingsMenu(false);
		setSettingsPanel('main');
		// Audio track change requires restarting the stream with the new track
		// For now, notify the user — a full restart would interrupt playback
	}, []);

	const toggleSettings = useCallback(() => {
		setShowSettingsMenu((v) => !v);
		setSettingsPanel('main');
	}, []);

	// Sprite preview tooltip rendered via portal so it escapes the
	// player bar's backdrop-filter stacking context — see the
	// commentary on `seekBarRect` for why.
	const spritePreview = renderSpritePortal({
		seekHover,
		seekBarRect,
		seekHoverX,
		meta: spriteMeta.value,
		movieId: globalMovieId.value,
	});

	return (
		<>
		<div
			data-player-panel
			class={`${styles.controls} ${visible ? styles.visible : ''} ${hasMiniThumbnail ? styles.miniMode : ''} ${isSplit ? styles.splitControls : ''}`}
		>
			{/* ── Row 1: Seek bar — flush to top, full width ── */}
			<div class={styles.seekRow}>
				<div
					ref={seekBarRef}
					class={`${styles.seekBar} ${isDragging ? styles.dragging : ''}`}
					onClick={handleSeekBarClick}
					onContextMenu={handleSeekContext}
					onMouseDown={handleSeekMouseDown}
					onMouseMove={handleSeekHover}
					onMouseLeave={() => {
						setSeekHover(null);
						setSeekBarRect(null);
					}}
					role="slider"
					aria-label="Seek"
					aria-valuemin={0}
					aria-valuemax={duration.value}
					aria-valuenow={currentTime.value}
				>
					<div class={styles.seekTrack}>
						<div class={styles.seekProgress} style={{ width: `${progress}%` }} />
						<div class={styles.seekThumb} style={{ left: `${progress}%` }} />
					</div>
					{seekHover !== null &&
						(() => {
							const meta = spriteMeta.value;
							// Fallback text-only tooltip when sprite meta
							// isn't loaded yet (or this movie has no sprite
							// sheet generated). Stays inside .seekBar
							// because the text is small + we don't need
							// the portal escape for it.
							if (!meta) {
								return (
									<div
										class={styles.seekTooltip}
										style={{
											left: `${(seekHover / (duration.value || 1)) * 100}%`,
										}}
									>
										{formatTime(seekHover)}
									</div>
								);
							}
							// Sprite preview: rendered into a portal below
							// (see {seekHover !== null && seekBarRect && …}
							// at the bottom of the .controls return JSX).
							// Inside the seekBar we render nothing here so
							// the original layout stays clean.
							return null;
						})()}
				</div>
			</div>

			{/* ── Row 2: Content row — optional left slot + controls ── */}
			<div class={styles.contentRow}>
				{leftSlot}
				<div class={styles.mainRow}>
					{/* Left: title + timing (hidden in split mode — shown above) */}
					{!isSplit && (
						<div class={styles.leftSection}>
							{title && globalMovieId.value && (
								<a
									// In share-watch mode the recipient can't reach
									// /movie/:id, so the title acts as an "open info"
									// affordance instead — same behaviour as the info
									// button in the player toolbar.
									href={
										shareMode.value
											? undefined
											: `/movie/${globalMovieId.value}`
									}
									class={styles.titleText}
									onClick={(e) => {
										e.preventDefault();
										if (shareMode.value) {
											onToggleInfo();
											return;
										}
										if (playerMode.value !== 'mini') {
											minimizePlayer();
										}
										route(`/movie/${globalMovieId.value}`);
									}}
								>
									{title}
								</a>
							)}
							<span class={styles.timingLabel}>
								{formatTime(currentTime.value)} / {formatTime(duration.value)}
							</span>
						</div>
					)}

					{/* Time display — left side in split mode */}
					{isSplit && (
						<div class={styles.splitTimeLeft}>
							{formatTime(currentTime.value)} / {formatTime(duration.value)}
						</div>
					)}

					{/*
					    Center (transport) + Right (secondary) wrapped in a
					    single .controlsBottomRow. Default `display: contents`
					    keeps this transparent on desktop / portrait; on mobile
					    landscape the wrapper becomes a flex row that puts
					    transport buttons and secondary buttons together as one
					    spread-out row beneath the title row.
					*/}
					<div class={styles.controlsBottomRow}>
						{/* Center: skip-back, play, skip-forward */}
						{(() => {
							const st = getUiSetting<number[]>('skip_times', [5, 10, 20]);
							const t = [st[0] ?? 5, st[1] ?? 10, st[2] ?? 20];
							return (
								<div
									class={`${styles.centerControls} ${isSplit ? styles.centerControlsSplit : ''}`}
								>
									{/* Skip Back — rollover reveals extended options */}
									<div
										class={styles.skipWrap}
										onMouseEnter={() => !isMobile && setSkipBackOpen(true)}
										onMouseLeave={() => !isMobile && setSkipBackOpen(false)}
									>
										<button
											class={`${styles.controlBtn} ${styles.skipBtn} ${skipBackOpen ? styles.skipBtnHidden : ''}`}
											onClick={() => {
												if (isMobile) {
													// Touch: tap toggles the expanded
													// time options outward. Auto-hide
													// after a few seconds; each option
													// tap resets the timer.
													const next = !skipBackOpen;
													setSkipBackOpen(next);
													if (next) armSkipBackAutoHide();
												} else {
													skipBack(t[0]);
												}
											}}
											aria-label="Skip back"
										>
											<svg
												width="20"
												height="20"
												viewBox="0 0 24 24"
												fill="none"
												stroke="white"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<polyline points="11 17 6 12 11 7" />
												<polyline points="18 17 13 12 18 7" />
											</svg>
										</button>
										{skipBackOpen && (
											<div
												class={`${styles.skipExtended} ${styles.skipExtendedLeft}`}
											>
												<button
													class={`${styles.controlBtn} ${styles.skipExtBtn}`}
													onClick={() => {
														skipBack(t[2]);
														armSkipBackAutoHide();
													}}
													aria-label={`Skip back ${t[2]}s`}
												>
													<span class={styles.skipExtText}>{t[2]}s</span>
												</button>
												<button
													class={`${styles.controlBtn} ${styles.skipExtBtn}`}
													onClick={() => {
														skipBack(t[1]);
														armSkipBackAutoHide();
													}}
													aria-label={`Skip back ${t[1]}s`}
												>
													<span class={styles.skipExtText}>{t[1]}s</span>
												</button>
												<button
													class={`${styles.controlBtn} ${styles.skipExtBtn}`}
													onClick={() => {
														skipBack(t[0]);
														armSkipBackAutoHide();
													}}
													aria-label={`Skip back ${t[0]}s`}
												>
													<span class={styles.skipExtText}>{t[0]}s</span>
												</button>
											</div>
										)}
									</div>

									<button
										class={`${styles.controlBtn} ${styles.playBtn}`}
										onClick={onTogglePlay}
										aria-label={isPlaying.value ? 'Pause' : 'Play'}
									>
										{isPlaying.value ? (
											<svg
												width="22"
												height="22"
												viewBox="0 0 24 24"
												fill="white"
											>
												<rect x="6" y="4" width="4" height="16" rx="1" />
												<rect x="14" y="4" width="4" height="16" rx="1" />
											</svg>
										) : (
											<svg
												width="22"
												height="22"
												viewBox="0 0 24 24"
												fill="white"
											>
												<path d="M8 5v14l11-7z" />
											</svg>
										)}
									</button>

									{/* Skip Forward — rollover reveals extended options */}
									<div
										class={styles.skipWrap}
										onMouseEnter={() => !isMobile && setSkipFwdOpen(true)}
										onMouseLeave={() => !isMobile && setSkipFwdOpen(false)}
									>
										<button
											class={`${styles.controlBtn} ${styles.skipBtn} ${skipFwdOpen ? styles.skipBtnHidden : ''}`}
											onClick={() => {
												if (isMobile) {
													const next = !skipFwdOpen;
													setSkipFwdOpen(next);
													if (next) armSkipFwdAutoHide();
												} else {
													skipForward(t[0]);
												}
											}}
											aria-label="Skip forward"
										>
											<svg
												width="20"
												height="20"
												viewBox="0 0 24 24"
												fill="none"
												stroke="white"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<polyline points="13 17 18 12 13 7" />
												<polyline points="6 17 11 12 6 7" />
											</svg>
										</button>
										{skipFwdOpen && (
											<div
												class={`${styles.skipExtended} ${styles.skipExtendedRight}`}
											>
												<button
													class={`${styles.controlBtn} ${styles.skipExtBtn}`}
													onClick={() => {
														skipForward(t[0]);
														armSkipFwdAutoHide();
													}}
													aria-label={`Skip forward ${t[0]}s`}
												>
													<span class={styles.skipExtText}>{t[0]}s</span>
												</button>
												<button
													class={`${styles.controlBtn} ${styles.skipExtBtn}`}
													onClick={() => {
														skipForward(t[1]);
														armSkipFwdAutoHide();
													}}
													aria-label={`Skip forward ${t[1]}s`}
												>
													<span class={styles.skipExtText}>{t[1]}s</span>
												</button>
												<button
													class={`${styles.controlBtn} ${styles.skipExtBtn}`}
													onClick={() => {
														skipForward(t[2]);
														armSkipFwdAutoHide();
													}}
													aria-label={`Skip forward ${t[2]}s`}
												>
													<span class={styles.skipExtText}>{t[2]}s</span>
												</button>
											</div>
										)}
									</div>
								</div>
							);
						})()}

						{/* Right: plugin buttons, info, volume, settings, fullscreen */}
						<div class={styles.rightControls}>
							{/* Plugin buttons — rendered before system buttons */}
							<PluginSlot name={UI.PLAYER_BUTTON} context={{}} />

							{/* Info — hidden in split mode (info shown inline) */}
							{!isSplit && (
								<button
									class={styles.controlBtn}
									onClick={onToggleInfo}
									aria-label="Movie info"
									title="Info"
								>
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="white"
										stroke-width="2"
									>
										<circle cx="12" cy="12" r="10" />
										<line x1="12" y1="16" x2="12" y2="12" />
										<line x1="12" y1="8" x2="12.01" y2="8" />
									</svg>
								</button>
							)}

							{/* Effects */}
							<div class={styles.effectsBtnWrap}>
								<div class={styles.effectsDots}>
									<span
										class={`${styles.effectsDot} ${eqEnabled.value ? styles.effectsDotActive : ''}`}
									/>
									<span
										class={`${styles.effectsDot} ${compressorEnabled.value ? styles.effectsDotActive : ''}`}
									/>
								</div>
								<div class={styles.effectsDotsBottom}>
									<span
										class={`${styles.effectsDot} ${videoEnabled.value ? styles.effectsDotActive : ''}`}
									/>
								</div>
								<button
									class={`${styles.controlBtn} ${showEffectsPanel.value ? styles.active : ''}`}
									onClick={toggleEffectsPanel}
									aria-label="Audio effects"
									title="Effects"
								>
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="white"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<line x1="4" y1="21" x2="4" y2="14" />
										<line x1="4" y1="10" x2="4" y2="3" />
										<line x1="12" y1="21" x2="12" y2="12" />
										<line x1="12" y1="8" x2="12" y2="3" />
										<line x1="20" y1="21" x2="20" y2="16" />
										<line x1="20" y1="12" x2="20" y2="3" />
										<line x1="1" y1="14" x2="7" y2="14" />
										<line x1="9" y1="8" x2="15" y2="8" />
										<line x1="17" y1="16" x2="23" y2="16" />
									</svg>
								</button>
							</div>

							{/* Volume */}
							<VolumeControl />

							{/* Settings */}
							<div class={styles.menuContainer} ref={settingsRef}>
								<button
									class={`${styles.controlBtn} ${showSettingsMenu ? styles.active : ''}`}
									onClick={toggleSettings}
									aria-label="Settings"
									title="Settings"
								>
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="white"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="12" cy="12" r="3" />
										<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
									</svg>
								</button>

								{showSettingsMenu && (
									<div class={styles.menu}>
										{settingsPanel === 'main' && (
											<>
												<button
													class={styles.menuRow}
													onClick={() => setSettingsPanel('quality')}
												>
													<span class={styles.menuRowLabel}>Quality</span>
													<span class={styles.menuRowValue}>
														{quality.value === 'auto'
															? 'Auto'
															: quality.value}
													</span>
													<span class={styles.menuRowChevron}>
														<Icon name="chevron-right" size={14} />
													</span>
												</button>

												<button
													class={styles.menuRow}
													onClick={() => setSettingsPanel('subtitles')}
												>
													<span class={styles.menuRowLabel}>
														Subtitles
													</span>
													<span class={styles.menuRowValue}>
														{subtitleTrack.value
															? (session?.subtitles?.find(
																	(t) =>
																		t.id ===
																		subtitleTrack.value,
																)?.label ?? 'On')
															: 'Off'}
													</span>
													<span class={styles.menuRowChevron}>
														<Icon name="chevron-right" size={14} />
													</span>
												</button>

												{(session?.audioTracks?.length ?? 0) > 1 && (
													<button
														class={styles.menuRow}
														onClick={() => setSettingsPanel('audio')}
													>
														<span class={styles.menuRowLabel}>
															Audio Track
														</span>
														<span class={styles.menuRowValue}>
															{audioTrack.value
																? (session?.audioTracks?.find(
																		(t) =>
																			String(t.id) ===
																			audioTrack.value,
																	)?.label ??
																	session?.audioTracks
																		?.find(
																			(t) =>
																				String(t.id) ===
																				audioTrack.value,
																		)
																		?.language?.toUpperCase() ??
																	`Track ${audioTrack.value}`)
																: (session?.audioTracks?.[0]
																		?.label ??
																	session?.audioTracks?.[0]?.language?.toUpperCase() ??
																	'Default')}
														</span>
														<span class={styles.menuRowChevron}>
															<Icon name="chevron-right" size={14} />
														</span>
													</button>
												)}
											</>
										)}

										{settingsPanel === 'quality' && (
											<>
												<button
													class={styles.menuBack}
													onClick={() => setSettingsPanel('main')}
												>
													<Icon name="chevron-left" size={14} /> Quality
												</button>
												<button
													class={`${styles.menuItem} ${quality.value === 'auto' ? styles.selected : ''}`}
													onClick={() => handleQualitySelect('auto')}
												>
													Auto
												</button>
												{(session?.qualities ?? []).map((q) => (
													<button
														key={q.label}
														class={`${styles.menuItem} ${
															quality.value === q.label
																? styles.selected
																: ''
														}`}
														onClick={() => handleQualitySelect(q.label)}
													>
														{q.label} ({q.height}p)
													</button>
												))}
											</>
										)}

										{settingsPanel === 'subtitles' && (
											<>
												<button
													class={styles.menuBack}
													onClick={() => setSettingsPanel('main')}
												>
													<Icon name="chevron-left" size={14} /> Subtitles
												</button>
												<button
													class={`${styles.menuItem} ${subtitleTrack.value === null ? styles.selected : ''}`}
													onClick={() => handleSubtitleSelect(null)}
												>
													Off
												</button>
												{(session?.subtitles ?? []).map((track) => (
													<button
														key={track.id}
														class={`${styles.menuItem} ${
															subtitleTrack.value === track.id
																? styles.selected
																: ''
														}`}
														onClick={() =>
															handleSubtitleSelect(track.id)
														}
													>
														{track.label}
													</button>
												))}
												<div class={styles.menuDivider} />
												<button
													class={styles.menuItem}
													onClick={() =>
														setSettingsPanel('subtitle-manage')
													}
												>
													Manage Subtitles{' '}
													<Icon name="chevron-right" size={14} />
												</button>
											</>
										)}

										{settingsPanel === 'subtitle-manage' && (
											<>
												<button
													class={styles.menuBack}
													onClick={() => setSettingsPanel('subtitles')}
												>
													<Icon name="chevron-left" size={14} /> Manage
													Subtitles
												</button>
												<div class={styles.menuPanelContent}>
													<SubtitleSettingsCollapsible />
													<div class={styles.menuDivider} />
													{globalMovieId.value && (
														<SubtitlePanel
															movieId={globalMovieId.value}
															fileName={
																globalMovie.value?.fileInfo
																	?.fileName ||
																globalMovie.value?.fileInfo?.filePath
																	?.split(/[/\\]/)
																	.pop() ||
																undefined
															}
															existingTracks={(
																session?.subtitles ?? []
															).map((t, i) => ({
																index: i,
																language: t.language,
																label: t.label,
															}))}
															onTrackDeleted={(track) => {
																const s = currentSession.value;
																if (!s) return;
																const activeId =
																	subtitleTrack.value;
																if (activeId) {
																	const activeSub =
																		s.subtitles.find(
																			(st) =>
																				st.id === activeId,
																		);
																	if (
																		activeSub &&
																		activeSub.label ===
																			track.label &&
																		activeSub.language ===
																			track.language
																	) {
																		subtitleTrack.value = null;
																		const mid =
																			globalMovieId.value;
																		if (mid)
																			saveSubtitleChoice(
																				mid,
																				null,
																			);
																	}
																}
															}}
															onSubtitlesChanged={async () => {
																const mid = globalMovieId.value;
																if (!mid) return;
																try {
																	const { subtitles: subs } =
																		await subtitlesService.list(
																			mid,
																		);
																	const s = currentSession.value;
																	if (!s) return;
																	currentSession.value = {
																		...s,
																		subtitles: subs.map(
																			(t, i) => ({
																				id: `sub-${i}`,
																				label: t.label,
																				language:
																					t.language,
																				url: `/api/v1/stream/${s.sessionId}/subtitles/${i}.vtt`,
																			}),
																		),
																	};
																} catch {}
															}}
															onSelect={(track) => {
																// Select this subtitle track for playback
																const s = currentSession.value;
																if (!s) return;
																const sub =
																	s.subtitles.find(
																		(st) =>
																			st.label ===
																				track.label &&
																			st.language ===
																				track.language,
																	) ?? s.subtitles[track.index];
																if (sub) {
																	const movieId =
																		globalMovieId.value;
																	if (movieId) {
																		saveSubtitleChoice(
																			movieId,
																			sub.id,
																		);
																	} else {
																		subtitleTrack.value =
																			sub.id;
																	}
																}
															}}
															onTrackAdded={(track) => {
																const s = currentSession.value;
																if (!s) return;
																const trackId = `sub-${track.index}`;
																const newTrack = {
																	id: trackId,
																	label: track.label,
																	language: track.language,
																	url: `/api/v1/stream/${s.sessionId}/subtitles/${track.index}.vtt`,
																};
																currentSession.value = {
																	...s,
																	subtitles: [
																		...s.subtitles,
																		newTrack,
																	],
																};
																const movieId = globalMovieId.value;
																if (movieId) {
																	saveSubtitleChoice(
																		movieId,
																		trackId,
																	);
																} else {
																	subtitleTrack.value = trackId;
																}
															}}
														/>
													)}
												</div>
											</>
										)}

										{settingsPanel === 'audio' && (
											<>
												<button
													class={styles.menuBack}
													onClick={() => setSettingsPanel('main')}
												>
													<Icon name="chevron-left" size={14} /> Audio
													Track
												</button>
												{(session?.audioTracks ?? []).map((track) => {
													const trackId = String(track.id);
													const isSelected = audioTrack.value
														? audioTrack.value === trackId
														: trackId ===
															String(session?.audioTracks?.[0]?.id);
													const lang = (
														track.language || 'und'
													).toUpperCase();
													const label =
														track.label &&
														track.label !== track.language
															? `${lang} — ${track.label}`
															: lang;
													const channels = track.channels
														? ` (${track.channels === 6 ? '5.1' : track.channels === 8 ? '7.1' : `${track.channels}ch`})`
														: '';
													return (
														<button
															key={trackId}
															class={`${styles.menuItem} ${isSelected ? styles.selected : ''}`}
															onClick={() =>
																handleAudioTrackSelect(trackId)
															}
														>
															{label}
															{channels}
														</button>
													);
												})}
											</>
										)}
									</div>
								)}
							</div>

							{/* Mobile overflow — only visible on mobile-mini (CSS-gated).
						    Surfaces the controls hidden by the mobile-mini @media
						    rule (info / effects / mute) so touch users can still
						    reach them without maximizing the player. */}
							{hasMiniThumbnail && (
								<div class={styles.mobileOverflow} ref={mobileOverflowRef}>
									<button
										class={`${styles.controlBtn} ${showMobileOverflow ? styles.active : ''}`}
										onClick={() => setShowMobileOverflow((v) => !v)}
										aria-label="More controls"
										aria-expanded={showMobileOverflow}
										title="More"
									>
										<svg
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="white"
											aria-hidden="true"
										>
											<circle cx="5" cy="12" r="2" />
											<circle cx="12" cy="12" r="2" />
											<circle cx="19" cy="12" r="2" />
										</svg>
									</button>

									{showMobileOverflow && (
										<div class={styles.mobileOverflowMenu} role="menu">
											<button
												type="button"
												class={styles.mobileOverflowItem}
												onClick={() => {
													setShowMobileOverflow(false);
													onToggleInfo();
												}}
											>
												<svg
													width="18"
													height="18"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													aria-hidden="true"
												>
													<circle cx="12" cy="12" r="10" />
													<line x1="12" y1="16" x2="12" y2="12" />
													<line x1="12" y1="8" x2="12.01" y2="8" />
												</svg>
												<span>Info</span>
											</button>
											<button
												type="button"
												class={`${styles.mobileOverflowItem} ${showEffectsPanel.value ? styles.mobileOverflowItemActive : ''}`}
												onClick={() => {
													setShowMobileOverflow(false);
													toggleEffectsPanel();
												}}
											>
												<svg
													width="18"
													height="18"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<line x1="4" y1="21" x2="4" y2="14" />
													<line x1="4" y1="10" x2="4" y2="3" />
													<line x1="12" y1="21" x2="12" y2="12" />
													<line x1="12" y1="8" x2="12" y2="3" />
													<line x1="20" y1="21" x2="20" y2="16" />
													<line x1="20" y1="12" x2="20" y2="3" />
													<line x1="1" y1="14" x2="7" y2="14" />
													<line x1="9" y1="8" x2="15" y2="8" />
													<line x1="17" y1="16" x2="23" y2="16" />
												</svg>
												<span>Effects</span>
											</button>
											<button
												type="button"
												class={styles.mobileOverflowItem}
												onClick={() => {
													toggleMute();
												}}
											>
												<VolumeIcon />
												<span>{isMuted.value ? 'Unmute' : 'Mute'}</span>
											</button>
											<button
												type="button"
												class={styles.mobileOverflowItem}
												onClick={() => {
													setShowMobileOverflow(false);
													onToggleFullscreen();
												}}
												aria-label="Maximize player"
											>
												<svg
													width="18"
													height="18"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<polyline points="18 15 12 9 6 15" />
												</svg>
												<span>Maximize</span>
											</button>
										</div>
									)}
								</div>
							)}

							{/* Fullscreen */}
							<button
								class={styles.controlBtn}
								onClick={onToggleFullscreen}
								aria-label={
									hasMiniThumbnail
										? 'Maximize player'
										: isFullscreen.value
											? 'Exit fullscreen'
											: 'Enter fullscreen'
								}
								title={
									hasMiniThumbnail
										? 'Maximize'
										: isFullscreen.value
											? 'Exit fullscreen'
											: 'Fullscreen'
								}
							>
								{hasMiniThumbnail ? (
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="white"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polyline points="18 15 12 9 6 15" />
									</svg>
								) : isFullscreen.value ? (
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="white"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
									</svg>
								) : (
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="white"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
									</svg>
								)}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
		{spritePreview}
		{shareMenu &&
			createPortal(
				<div
					class={styles.shareMenu}
					style={{ left: `${shareMenu.x}px`, top: `${shareMenu.y}px` }}
					onMouseDown={(e) => e.stopPropagation()}
					onContextMenu={(e) => e.preventDefault()}
				>
					<div class={styles.shareMenuLabel}>Copy URL at {formatTime(shareMenu.time)}</div>
					<div class={styles.shareMenuActions}>
						<button
							type="button"
							class={styles.shareMenuBtn}
							disabled={shareBusy}
							onClick={() => copyShareAtTime('public')}
						>
							Public
						</button>
						<button
							type="button"
							class={styles.shareMenuBtn}
							disabled={shareBusy}
							onClick={() => copyShareAtTime('private')}
						>
							Private
						</button>
					</div>
				</div>,
				document.body,
			)}
		</>
	);
}

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CommentTooltip } from '@/components/comments/CommentTooltip';
import { useUiSetting } from '@/hooks/useUiSetting';
import type { MovieComment } from '@/services/comments.service';
import { currentUser } from '@/state/auth.state';
import { getTimedComments, loadComments, movieComments } from '@/state/comments.state';
import { globalMovieId, playerMode } from '@/state/globalPlayer.state';
import { currentTime, duration, spriteMeta } from '@/state/player.state';
import { shareMode } from '@/state/share.state';
import { timeFromPointer } from '@/utils/seek-time';
import styles from '../PlayerControls.module.scss';
import { formatTime } from './formatTime';
import { ShareMenu, type ShareMenuState } from './ShareMenu';
import { renderSpritePortal } from './SpritePreview';
import type { ControlGroupProps } from './types';

const DRAG_THROTTLE_MS = 15;

/**
 * The seek bar: progress track + thumb, drag/click seeking, hover time /
 * sprite preview (portaled), timed-comment bubbles and the right-click
 * share / comment menu.
 */
export function SeekBar({ onSeek }: ControlGroupProps) {
	const [seekHover, setSeekHover] = useState<number | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const seekBarRef = useRef<HTMLDivElement>(null);
	const dragLastSeek = useRef<number>(0);

	const progress = duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0;

	// ── Seek bar: click ──
	const seekFromEvent = useCallback(
		(e: MouseEvent) => timeFromPointer(seekBarRef.current, e.clientX, duration.value),
		[],
	);

	// ── Seek bar: right-click → "Copy URL at Time" (public/private share) ──
	const [shareMenu, setShareMenu] = useState<ShareMenuState | null>(null);

	// ── Comments: draft entry (right-click → Add Comment) + bubble hover ──
	const [commentDraft, setCommentDraft] = useState<{ x: number; time: number } | null>(null);
	const [hoverComment, setHoverComment] = useState<{
		comment: MovieComment;
		x: number;
	} | null>(null);
	const hoverCommentTimer = useRef<number | null>(null);
	const [showCommentBubbles] = useUiSetting('player_show_comment_bubbles', false);
	// Load comments for the playing movie (cheap — shared client cache).
	useEffect(() => {
		const mid = globalMovieId.value;
		if (mid) loadComments(mid).catch(() => {});
	}, [globalMovieId.value]);
	// Subscribe so bubbles re-render when the movie's comments change.
	void movieComments.value;

	const isSplitMode = playerMode.value === 'split';
	/** Anchor Y for comment tooltips: above the bar in mini/full, below in split. */
	const commentTooltipY = useCallback(
		(rect: { top: number } | null) => {
			const barTop = rect?.top ?? seekBarRef.current?.getBoundingClientRect().top ?? 0;
			const barBottom = seekBarRef.current?.getBoundingClientRect().bottom ?? barTop + 8;
			return isSplitMode ? barBottom + 10 : barTop - 10;
		},
		[isSplitMode],
	);

	const cancelHoverCommentClose = useCallback(() => {
		if (hoverCommentTimer.current !== null) {
			clearTimeout(hoverCommentTimer.current);
			hoverCommentTimer.current = null;
		}
	}, []);
	const scheduleHoverCommentClose = useCallback(() => {
		cancelHoverCommentClose();
		hoverCommentTimer.current = window.setTimeout(() => setHoverComment(null), 200);
	}, [cancelHoverCommentClose]);

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
		const time = timeFromPointer(bar, e.clientX, duration.value);
		if (time == null) return;
		setSeekHover(time);
		setSeekHoverX(e.clientX - rect.left);
		setSeekBarRect({ left: rect.left, top: rect.top, width: rect.width });
	}, []);

	// ── Seek bar: drag (pointer events: mouse, touch and pen) ──
	// Mouse-only listeners meant a finger could tap but never drag on mobile.
	// Pointer capture keeps the drag going when the finger leaves the bar.
	const draggingRef = useRef(false);
	const seekAtPointer = useCallback(
		(clientX: number) => {
			const bar = seekBarRef.current;
			if (!bar) return;
			const rect = bar.getBoundingClientRect();
			const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			onSeek(fraction * duration.value);
		},
		[onSeek],
	);

	const handleSeekPointerDown = useCallback(
		(e: PointerEvent) => {
			// Only the primary button / a touch drags. Right-click is reserved
			// for the "Copy URL at Time" menu and must not move the playhead.
			if (e.button !== 0) return;
			e.preventDefault();
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
			draggingRef.current = true;
			setIsDragging(true);
			dragLastSeek.current = 0;
			// Touch has no hover: show the thumbnail preview while dragging.
			if (e.pointerType !== 'mouse') handleSeekHover(e);
			seekAtPointer(e.clientX);
		},
		[seekAtPointer, handleSeekHover],
	);

	const handleSeekPointerMove = useCallback(
		(e: PointerEvent) => {
			if (e.pointerType === 'mouse' || draggingRef.current) handleSeekHover(e);
			if (!draggingRef.current) return;
			const now = performance.now();
			if (now - dragLastSeek.current < DRAG_THROTTLE_MS) return;
			dragLastSeek.current = now;
			seekAtPointer(e.clientX);
		},
		[seekAtPointer, handleSeekHover],
	);

	const handleSeekPointerUp = useCallback(
		(e: PointerEvent) => {
			if (!draggingRef.current) return;
			draggingRef.current = false;
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
			if (e.type !== 'pointercancel') seekAtPointer(e.clientX);
			// Clear the click guard after this event's click has fired.
			setTimeout(() => setIsDragging(false), 0);
			if (e.pointerType !== 'mouse') {
				setSeekHover(null);
				setSeekBarRect(null);
			}
		},
		[seekAtPointer],
	);

	// Sprite preview tooltip rendered via portal so it escapes the
	// player bar's backdrop-filter stacking context — see the
	// commentary on `seekBarRect` for why.
	const commentEntryPortal =
		commentDraft && globalMovieId.value ? (
			<CommentTooltip
				movieId={globalMovieId.value}
				x={commentDraft.x}
				y={commentTooltipY(null)}
				placement={isSplitMode ? 'below' : 'above'}
				timeSeconds={commentDraft.time}
				currentUserId={currentUser.value?.id ?? null}
				onClose={() => setCommentDraft(null)}
			/>
		) : null;

	const commentHoverPortal =
		hoverComment && globalMovieId.value ? (
			<CommentTooltip
				movieId={globalMovieId.value}
				x={hoverComment.x}
				y={commentTooltipY(null)}
				placement={isSplitMode ? 'below' : 'above'}
				comment={hoverComment.comment}
				currentUserId={currentUser.value?.id ?? null}
				onClose={() => setHoverComment(null)}
				onMouseEnter={cancelHoverCommentClose}
				onMouseLeave={scheduleHoverCommentClose}
			/>
		) : null;

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
				ref={seekBarRef}
				class={`${styles.seekBar} ${isDragging ? styles.dragging : ''}`}
				onClick={handleSeekBarClick}
				onContextMenu={handleSeekContext}
				onPointerDown={handleSeekPointerDown}
				onPointerMove={handleSeekPointerMove}
				onPointerUp={handleSeekPointerUp}
				onPointerCancel={handleSeekPointerUp}
				onMouseLeave={() => {
					if (draggingRef.current) return;
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
				{showCommentBubbles &&
					duration.value > 0 &&
					globalMovieId.value &&
					getTimedComments(globalMovieId.value).map((c) => {
						const initials = (c.authorName || '?')
							.split(/\s+/)
							.map((w) => w[0])
							.join('')
							.slice(0, 2)
							.toUpperCase();
						return (
							<button
								key={c.id}
								class={styles.commentBubble}
								style={{
									left: `${Math.min(100, ((c.timeSeconds ?? 0) / duration.value) * 100)}%`,
								}}
								onClick={(e: Event) => e.stopPropagation()}
								onPointerDown={(e: Event) => e.stopPropagation()}
								onMouseDown={(e: Event) => e.stopPropagation()}
								onMouseEnter={(e: MouseEvent) => {
									cancelHoverCommentClose();
									const r = (
										e.currentTarget as HTMLElement
									).getBoundingClientRect();
									setHoverComment({
										comment: c,
										x: r.left + r.width / 2,
									});
								}}
								onMouseLeave={scheduleHoverCommentClose}
							>
								{initials}
							</button>
						);
					})}
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
						// ({spritePreview}). Inside the seekBar we render
						// nothing here so the original layout stays clean.
						return null;
					})()}
			</div>
			{spritePreview}
			{commentEntryPortal}
			{commentHoverPortal}
			{shareMenu && (
				<ShareMenu
					menu={shareMenu}
					onClose={() => setShareMenu(null)}
					onAddComment={(x, time) => setCommentDraft({ x, time })}
				/>
			)}
		</>
	);
}

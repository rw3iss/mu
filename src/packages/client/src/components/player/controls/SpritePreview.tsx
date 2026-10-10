import { signal } from '@preact/signals';
import { createPortal } from 'preact/compat';
import type { SpriteMeta } from '@/state/player.state';
import { formatTime } from './formatTime';

/**
 * Measured real frame dimensions per sprite set. The server meta's
 * frameWidth/frameHeight historically assumed 16:9, but sheets are generated
 * with `scale=W:-2` (source aspect ratio preserved) — so for non-16:9 movies
 * the meta height is wrong and the preview skews. Measuring sheet 0's bitmap
 * gives the true tile size; the popup then adapts per movie.
 */
const sheetDimsCache = new Map<string, { w: number; h: number }>();
const sheetDimsPending = new Set<string>();
const sheetDimsVersion = signal(0);

function measuredFrameDims(movieId: string, meta: SpriteMeta): { w: number; h: number } | null {
	// Subscribe the calling component to measurement completions.
	void sheetDimsVersion.value;
	const size = meta.size ?? 'large';
	const key = `${movieId}:${size}`;
	const cached = sheetDimsCache.get(key);
	if (cached) return cached;
	if (!sheetDimsPending.has(key) && typeof Image !== 'undefined') {
		sheetDimsPending.add(key);
		const img = new Image();
		img.onload = () => {
			// Sheet 0's actual row count (short videos may not fill the grid).
			const sheet0Rows = Math.ceil(
				Math.min(meta.totalFrames, meta.columns * meta.rows) / meta.columns,
			);
			if (img.naturalWidth > 0 && sheet0Rows > 0) {
				sheetDimsCache.set(key, {
					w: img.naturalWidth / meta.columns,
					h: img.naturalHeight / sheet0Rows,
				});
				sheetDimsVersion.value++;
			}
		};
		img.src = `/api/v1/media/sprites/${movieId}/0.jpg?size=${encodeURIComponent(size)}`;
	}
	return null;
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
export function renderSpritePortal(args: {
	seekHover: number | null;
	seekBarRect: { left: number; top: number; width: number } | null;
	seekHoverX: number;
	meta: SpriteMeta | null;
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

	// Real tile size measured from the sheet bitmap (adapts to the movie's
	// aspect ratio); falls back to meta until the measurement resolves.
	const dims = measuredFrameDims(movieId, meta);
	const frameW = dims?.w ?? meta.frameWidth;
	const frameH = dims?.h ?? meta.frameHeight;

	// Sprite math
	const frameIndex = Math.min(Math.floor(seekHover / meta.interval), meta.totalFrames - 1);
	const framesPerSheet = meta.columns * meta.rows;
	const sheetIndex = Math.floor(frameIndex / framesPerSheet);
	const frameInSheet = frameIndex % framesPerSheet;
	const col = frameInSheet % meta.columns;
	const row = Math.floor(frameInSheet / meta.columns);
	const bgX = -(col * frameW);
	const bgY = -(row * frameH);

	// Position the tooltip 14px above the seek bar's top, centered on
	// the cursor. Clamp horizontally to the viewport so the tooltip
	// never overflows the screen edge.
	const tooltipWidth = frameW + 4;
	const halfWidth = tooltipWidth / 2;
	const viewportWidth = window.innerWidth;
	const clampedX = Math.max(halfWidth, Math.min(cursorX, viewportWidth - halfWidth));
	const top = seekBarRect.top - frameH - 28;

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
				zIndex: 'var(--z-portal-overlay)',
			}}
		>
			<div
				style={{
					width: `${frameW}px`,
					height: `${frameH}px`,
					border: '2px solid rgba(255,255,255,0.9)',
					borderRadius: `${cornerRadiusPx}px`,
					boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
					backgroundColor: '#000',
					backgroundRepeat: 'no-repeat',
					backgroundImage: `url(/api/v1/media/sprites/${movieId}/${sheetIndex}.jpg?size=${encodeURIComponent(meta.size ?? 'large')})`,
					backgroundPosition: `${bgX}px ${bgY}px`,
					// Width-only sizing: height follows the bitmap's own aspect
					// ratio, so tiles are never stretched (incl. partial last sheets).
					backgroundSize: `${frameW * meta.columns}px auto`,
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

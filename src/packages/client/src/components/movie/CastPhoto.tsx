import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import styles from './CastPhoto.module.scss';

interface CastPhotoProps {
	name: string;
	profileUrl?: string;
	character?: string;
	/** Diameter of the inline thumbnail, in px. */
	size?: number;
	/** Diameter of the popout when expanded, in px. */
	expandedSize?: number;
	/** Optional extra class on the inline thumbnail (so the existing
	 * border-radius / background tokens for each surface still apply). */
	thumbClass?: string;
}

interface PopoutPos {
	left: number;
	top: number;
	originX: number;
	originY: number;
}

/**
 * Cast member photo with a click-to-expand popout. The popout is
 * rendered through a portal at document.body with `position: fixed`,
 * so it escapes any ancestor with `overflow: hidden|auto` (e.g. the
 * scrolling InfoPanel flyout). The scale-up entry animation is
 * anchored to the original thumb center via dynamic transform-origin.
 */
export function CastPhoto({
	name,
	profileUrl,
	character: _character,
	size = 48,
	expandedSize = 200,
	thumbClass,
}: CastPhotoProps) {
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<PopoutPos | null>(null);
	const closeTimerRef = useRef<number | null>(null);
	const thumbRef = useRef<HTMLButtonElement>(null);
	const popoutRef = useRef<HTMLDivElement>(null);

	const cancelClose = () => {
		if (closeTimerRef.current !== null) {
			clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	};

	const scheduleClose = () => {
		cancelClose();
		closeTimerRef.current = window.setTimeout(() => {
			setOpen(false);
			closeTimerRef.current = null;
		}, 300);
	};

	useEffect(() => () => cancelClose(), []);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			const t = e.target as Node;
			if (thumbRef.current?.contains(t)) return;
			if (popoutRef.current?.contains(t)) return;
			cancelClose();
			setOpen(false);
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [open]);

	// Close on viewport changes — the popout is positioned off a
	// snapshot of the thumb's rect, so any scroll/resize would
	// desync it from the source thumb.
	useEffect(() => {
		if (!open) return;
		const close = () => setOpen(false);
		window.addEventListener('scroll', close, true);
		window.addEventListener('resize', close);
		return () => {
			window.removeEventListener('scroll', close, true);
			window.removeEventListener('resize', close);
		};
	}, [open]);

	const computePos = (): PopoutPos | null => {
		if (!thumbRef.current) return null;
		const r = thumbRef.current.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		const margin = 8;
		const left = Math.max(
			margin,
			Math.min(window.innerWidth - expandedSize - margin, cx - expandedSize / 2),
		);
		const top = Math.max(
			margin,
			Math.min(window.innerHeight - expandedSize - margin, cy - expandedSize / 2),
		);
		return { left, top, originX: cx - left, originY: cy - top };
	};

	const handleThumbClick = (e: MouseEvent) => {
		// stopPropagation alone is NOT enough when this thumb lives inside
		// an `<a href>` wrapper (cast row in MovieDetail / InfoPanel): the
		// outer link's *default* navigation runs independently of its
		// onClick handler, and preventDefault on the child is what blocks
		// it. Without this the photo click both enlarges the thumb AND
		// navigates to the person page — fixed here.
		e.stopPropagation();
		e.preventDefault();
		if (open) {
			setOpen(false);
			return;
		}
		setPos(computePos());
		setOpen(true);
	};

	const fallback = name?.trim().charAt(0).toUpperCase() || '?';
	const closedScale = size / expandedSize;

	return (
		<div class={styles.wrap} style={{ width: `${size}px`, height: `${size}px` }}>
			<button
				ref={thumbRef}
				type="button"
				class={`${styles.thumb} ${thumbClass ?? ''}`}
				onClick={handleThumbClick}
				aria-label={`Show ${name}'s photo`}
			>
				{profileUrl ? (
					<img src={profileUrl} alt={name} loading="lazy" />
				) : (
					<span class={styles.fallback}>{fallback}</span>
				)}
			</button>
			{open &&
				pos &&
				createPortal(
					<div
						ref={popoutRef}
						class={styles.popout}
						style={{
							width: `${expandedSize}px`,
							height: `${expandedSize}px`,
							left: `${pos.left}px`,
							top: `${pos.top}px`,
							transformOrigin: `${pos.originX}px ${pos.originY}px`,
							['--cast-popout-close-scale' as string]: String(closedScale),
						}}
						onMouseEnter={cancelClose}
						onMouseLeave={scheduleClose}
						onClick={(e: MouseEvent) => {
							// Click on the popout closes it — same effect as the
							// hover-out grace timer firing. Swallow propagation so
							// the InfoPanel / MovieDetail underneath stays open.
							e.stopPropagation();
							e.preventDefault();
							cancelClose();
							setOpen(false);
						}}
						role="dialog"
						aria-label={`${name}'s photo — click to close`}
					>
						{profileUrl ? (
							<img src={profileUrl} alt={name} />
						) : (
							<span class={styles.popoutFallback}>{fallback}</span>
						)}
					</div>,
					document.body,
				)}
		</div>
	);
}

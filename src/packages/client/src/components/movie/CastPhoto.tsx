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

/**
 * Cast member photo with a click-to-expand popout. The popout is
 * absolutely positioned over the thumbnail (no parent relayout) and
 * organically scales up from the thumbnail's footprint via CSS. It
 * stays open until the cursor leaves the popout for ~300ms; hovering
 * back over cancels the close.
 *
 * Designed to be a drop-in replacement for the existing 32–48 px
 * circular cast avatars in InfoPanel / MovieDetail / split-mode
 * panel — the thumbClass prop lets each surface keep its own border
 * + background while CastPhoto owns the click + popout behaviour.
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
	const closeTimerRef = useRef<number | null>(null);
	const wrapRef = useRef<HTMLDivElement>(null);

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

	// Outside-click closes immediately (skip the 300ms grace).
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (!wrapRef.current?.contains(e.target as Node)) {
				cancelClose();
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [open]);

	const handleThumbClick = (e: MouseEvent) => {
		e.stopPropagation();
		// Toggle: clicking the thumb a second time before the timeout
		// expires should close it cleanly.
		setOpen((o) => !o);
	};

	const fallback = name?.trim().charAt(0).toUpperCase() || '?';
	// Initial CSS scale for the popout — sized so the popout enters from
	// roughly the thumbnail's footprint, then expands to its full size.
	const closedScale = size / expandedSize;

	return (
		<div ref={wrapRef} class={styles.wrap} style={{ width: `${size}px`, height: `${size}px` }}>
			<button
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
			{open && (
				<div
					class={styles.popout}
					style={{
						width: `${expandedSize}px`,
						height: `${expandedSize}px`,
						// Used by the entry keyframe so the popout grows
						// from the thumbnail's footprint instead of from 0.
						['--cast-popout-close-scale' as string]: String(closedScale),
					}}
					onMouseEnter={cancelClose}
					onMouseLeave={scheduleClose}
					onClick={(e: Event) => e.stopPropagation()}
					role="dialog"
					aria-label={`${name}'s photo`}
				>
					{profileUrl ? (
						<img src={profileUrl} alt={name} />
					) : (
						<span class={styles.popoutFallback}>{fallback}</span>
					)}
				</div>
			)}
		</div>
	);
}

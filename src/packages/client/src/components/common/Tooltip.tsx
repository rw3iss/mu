import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useRef, useState } from 'preact/hooks';
import styles from './Tooltip.module.scss';

type Placement = 'top' | 'bottom';

interface TooltipProps {
	/** Tooltip contents. When falsy, the trigger renders bare (no tooltip). */
	label: ComponentChildren;
	/** Side of the trigger to anchor on. Default `top`. */
	placement?: Placement;
	/** Hover/focus dwell before showing, in ms. Default 350. */
	delay?: number;
	/** Class applied to the inline wrapper around the trigger. */
	class?: string;
	children: ComponentChildren;
}

interface Coords {
	top: number;
	left: number;
	placement: Placement;
}

// Stable id source for `aria-describedby` without depending on a specific
// Preact `useId` version.
let tooltipCounter = 0;

/**
 * Lightweight, themed tooltip — a styled, accessible replacement for the
 * native `title=` attribute (which is slow, unstyled, un-themeable, and
 * absent on touch).
 *
 * Shows on hover or keyboard focus of the wrapped trigger after a short
 * dwell; hides on leave / blur / Escape. The bubble is portalled to
 * `document.body` and positioned with `position: fixed` from the trigger's
 * measured rect, so it never clips inside `overflow:hidden` toolbars.
 * Entrance animation is reduce-motion safe (global override neutralises it).
 *
 *   <Tooltip label="Grid view"><button>…</button></Tooltip>
 */
export function Tooltip({
	label,
	placement = 'top',
	delay = 350,
	class: className,
	children,
}: TooltipProps) {
	const triggerRef = useRef<HTMLSpanElement>(null);
	const timerRef = useRef<number | null>(null);
	const idRef = useRef<string>();
	const [coords, setCoords] = useState<Coords | null>(null);

	if (!idRef.current) idRef.current = `tooltip-${++tooltipCounter}`;
	const tipId = idRef.current;

	const show = useCallback(() => {
		const measure = () => {
			const el = triggerRef.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const gap = 8;
			setCoords({
				top: placement === 'top' ? r.top - gap : r.bottom + gap,
				left: r.left + r.width / 2,
				placement,
			});
		};
		if (delay <= 0) {
			measure();
			return;
		}
		timerRef.current = window.setTimeout(measure, delay);
	}, [delay, placement]);

	const hide = useCallback(() => {
		if (timerRef.current != null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setCoords(null);
	}, []);

	if (!label) return <>{children}</>;

	return (
		<span
			ref={triggerRef}
			class={className}
			style={{ display: 'inline-flex' }}
			onMouseEnter={show}
			onMouseLeave={hide}
			onFocusIn={show}
			onFocusOut={hide}
			aria-describedby={coords ? tipId : undefined}
		>
			{children}
			{coords &&
				createPortal(
					<div
						id={tipId}
						role="tooltip"
						class={`${styles.tip} ${coords.placement === 'top' ? styles.top : styles.bottom}`}
						style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
					>
						{label}
					</div>,
					document.body,
				)}
		</span>
	);
}

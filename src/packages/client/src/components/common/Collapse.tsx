import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import styles from './Collapse.module.scss';

interface CollapseProps {
	/** When true the content is expanded; false collapses it (animated). */
	open: boolean;
	children: ComponentChildren;
	/** Optional extra class on the outer wrapper. */
	class?: string;
}

/** Matches the CSS transition duration below — keep in sync. */
const DURATION_MS = 220;

/**
 * Animated collapse/expand using the `grid-template-rows: 0fr → 1fr`
 * technique, so it animates to the content's natural height with no
 * JS measurement. Children mount only while open (plus the closing
 * animation window), so lazy sections don't eager-load when collapsed.
 *
 * `settled` flips overflow back to visible once fully open so hover
 * previews / tooltips inside aren't clipped.
 */
export function Collapse({ open, children, class: className }: CollapseProps) {
	const [mounted, setMounted] = useState(open);
	const [expanded, setExpanded] = useState(open);
	const [settled, setSettled] = useState(open);
	const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

	useEffect(() => {
		for (const t of timers.current) clearTimeout(t);
		timers.current = [];
		if (open) {
			setMounted(true);
			// Two frames so the 0fr starting state is committed before we
			// flip to 1fr — otherwise the browser skips the transition.
			requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
			timers.current.push(setTimeout(() => setSettled(true), DURATION_MS + 20));
		} else {
			setSettled(false);
			setExpanded(false);
			timers.current.push(setTimeout(() => setMounted(false), DURATION_MS + 20));
		}
		return () => {
			for (const t of timers.current) clearTimeout(t);
			timers.current = [];
		};
	}, [open]);

	if (!mounted) return null;

	return (
		<div class={`${styles.collapse} ${expanded ? styles.open : ''} ${className ?? ''}`}>
			<div class={`${styles.inner} ${settled ? styles.settled : ''}`}>{children}</div>
		</div>
	);
}

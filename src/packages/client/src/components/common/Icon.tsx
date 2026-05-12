import { JSX } from 'preact';

/**
 * Single-color line icons used throughout the app. Each icon is a
 * 24×24 viewBox using stroke="currentColor" so it tracks the parent
 * text color and integrates cleanly with light/dark themes. Use this
 * instead of emoji glyphs (👁, 🌙, 🗑, …) or BMP-art glyphs (▦, ☰, ★)
 * for any button/control icon.
 *
 * Sizing: pass `size` (number → pixels) or set `width`/`height` via
 * style. Default is `1em` so the icon scales with surrounding text.
 */
export type IconName =
	// visibility / theme
	| 'eye'
	| 'eye-off'
	| 'sun'
	| 'moon'
	| 'monitor'
	// arrows / chevrons
	| 'chevron-up'
	| 'chevron-down'
	| 'chevron-left'
	| 'chevron-right'
	| 'arrow-up'
	| 'arrow-down'
	| 'arrow-left'
	| 'arrow-right'
	| 'arrow-up-right'
	// view modes
	| 'view-large'
	| 'view-grid'
	| 'view-list'
	// actions
	| 'edit'
	| 'check'
	| 'check-circle'
	| 'x'
	| 'x-circle'
	| 'plus'
	| 'minus'
	| 'trash'
	| 'refresh'
	| 'search'
	| 'settings'
	| 'share'
	| 'play'
	| 'pause'
	| 'layers'
	// app surfaces
	| 'home'
	| 'film'
	| 'list-plus'
	| 'star'
	| 'star-filled'
	| 'warning'
	| 'info'
	| 'image-broken';

interface IconProps {
	name: IconName;
	/** Size in pixels. Defaults to `1em` so the icon scales with parent font-size. */
	size?: number | string;
	class?: string;
	style?: JSX.CSSProperties;
	'aria-label'?: string;
	/** Pass `true` to make the icon focusable for keyboard nav. Defaults false. */
	focusable?: boolean;
	/** Override stroke width; defaults to 1.75 for a thin-line look. */
	strokeWidth?: number;
}

/**
 * Path data for every icon. Each entry is the raw inner SVG (paths,
 * circles, polylines) — the wrapper `<svg>` handles viewBox + stroke.
 * Stroke-based; never filled (except where noted, e.g. star-filled).
 */
const PATHS: Record<IconName, JSX.Element> = {
	// ── visibility / theme ──
	eye: (
		<>
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
	'eye-off': (
		<>
			<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 4.06-5.06" />
			<path d="M9.9 5.08A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-2.06 2.94" />
			<path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
			<line x1="2" y1="2" x2="22" y2="22" />
		</>
	),
	sun: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
		</>
	),
	moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
	monitor: (
		<>
			<rect x="2" y="4" width="20" height="13" rx="2" />
			<line x1="8" y1="21" x2="16" y2="21" />
			<line x1="12" y1="17" x2="12" y2="21" />
		</>
	),

	// ── arrows / chevrons ──
	'chevron-up': <polyline points="18 15 12 9 6 15" />,
	'chevron-down': <polyline points="6 9 12 15 18 9" />,
	'chevron-left': <polyline points="15 18 9 12 15 6" />,
	'chevron-right': <polyline points="9 18 15 12 9 6" />,
	'arrow-up': (
		<>
			<line x1="12" y1="19" x2="12" y2="5" />
			<polyline points="5 12 12 5 19 12" />
		</>
	),
	'arrow-down': (
		<>
			<line x1="12" y1="5" x2="12" y2="19" />
			<polyline points="19 12 12 19 5 12" />
		</>
	),
	'arrow-left': (
		<>
			<line x1="19" y1="12" x2="5" y2="12" />
			<polyline points="12 19 5 12 12 5" />
		</>
	),
	'arrow-right': (
		<>
			<line x1="5" y1="12" x2="19" y2="12" />
			<polyline points="12 5 19 12 12 19" />
		</>
	),
	'arrow-up-right': (
		<>
			<line x1="7" y1="17" x2="17" y2="7" />
			<polyline points="7 7 17 7 17 17" />
		</>
	),

	// ── view modes ──
	'view-large': <rect x="4" y="4" width="16" height="16" rx="2" />,
	'view-grid': (
		<>
			<rect x="3" y="3" width="7" height="7" rx="1" />
			<rect x="14" y="3" width="7" height="7" rx="1" />
			<rect x="3" y="14" width="7" height="7" rx="1" />
			<rect x="14" y="14" width="7" height="7" rx="1" />
		</>
	),
	'view-list': (
		<>
			<line x1="4" y1="6" x2="20" y2="6" />
			<line x1="4" y1="12" x2="20" y2="12" />
			<line x1="4" y1="18" x2="20" y2="18" />
		</>
	),

	// ── actions ──
	edit: (
		<>
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
		</>
	),
	check: <polyline points="20 6 9 17 4 12" />,
	'check-circle': (
		<>
			<circle cx="12" cy="12" r="10" />
			<polyline points="16 9 11 14 8 11" />
		</>
	),
	x: (
		<>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</>
	),
	'x-circle': (
		<>
			<circle cx="12" cy="12" r="10" />
			<line x1="15" y1="9" x2="9" y2="15" />
			<line x1="9" y1="9" x2="15" y2="15" />
		</>
	),
	plus: (
		<>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</>
	),
	minus: <line x1="5" y1="12" x2="19" y2="12" />,
	trash: (
		<>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
			<path d="M10 11v6M14 11v6" />
			<path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
		</>
	),
	refresh: (
		<>
			<polyline points="23 4 23 10 17 10" />
			<polyline points="1 20 1 14 7 14" />
			<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<line x1="21" y1="21" x2="16.65" y2="16.65" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</>
	),
	share: (
		<>
			<circle cx="18" cy="5" r="3" />
			<circle cx="6" cy="12" r="3" />
			<circle cx="18" cy="19" r="3" />
			<line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
			<line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
		</>
	),
	play: <polygon points="6 4 20 12 6 20 6 4" />,
	pause: (
		<>
			<rect x="6" y="4" width="4" height="16" />
			<rect x="14" y="4" width="4" height="16" />
		</>
	),
	layers: (
		<>
			<polygon points="12 2 2 7 12 12 22 7 12 2" />
			<polyline points="2 17 12 22 22 17" />
			<polyline points="2 12 12 17 22 12" />
		</>
	),

	// ── app surfaces ──
	home: (
		<>
			<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-6h-2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
		</>
	),
	film: (
		<>
			<rect x="2" y="3" width="20" height="18" rx="2" />
			<line x1="7" y1="3" x2="7" y2="21" />
			<line x1="17" y1="3" x2="17" y2="21" />
			<line x1="2" y1="8" x2="7" y2="8" />
			<line x1="2" y1="16" x2="7" y2="16" />
			<line x1="17" y1="8" x2="22" y2="8" />
			<line x1="17" y1="16" x2="22" y2="16" />
		</>
	),
	'list-plus': (
		<>
			<line x1="3" y1="6" x2="14" y2="6" />
			<line x1="3" y1="12" x2="14" y2="12" />
			<line x1="3" y1="18" x2="10" y2="18" />
			<line x1="18" y1="14" x2="18" y2="22" />
			<line x1="14" y1="18" x2="22" y2="18" />
		</>
	),
	star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
	'star-filled': (
		<polygon
			points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
			fill="currentColor"
		/>
	),
	warning: (
		<>
			<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
			<line x1="12" y1="9" x2="12" y2="13" />
			<line x1="12" y1="17" x2="12.01" y2="17" />
		</>
	),
	info: (
		<>
			<circle cx="12" cy="12" r="10" />
			<line x1="12" y1="16" x2="12" y2="12" />
			<line x1="12" y1="8" x2="12.01" y2="8" />
		</>
	),
	'image-broken': (
		<>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<line x1="3" y1="3" x2="21" y2="21" />
			<circle cx="8.5" cy="8.5" r="1.5" />
			<polyline points="21 15 16 10 11 15" />
		</>
	),
};

export function Icon({
	name,
	size,
	class: className,
	style,
	'aria-label': ariaLabel,
	focusable = false,
	strokeWidth = 1.75,
}: IconProps) {
	const dim = size ?? '1em';
	// The global reset sets `svg { display: block }` (good for media
	// elements, bad for inline icons), so override here so the Icon sits
	// happily next to text in buttons / labels. Callers can still pass a
	// `style` to override.
	const mergedStyle: JSX.CSSProperties = {
		display: 'inline-block',
		verticalAlign: '-0.15em',
		flexShrink: 0,
		...style,
	};
	return (
		<svg
			class={className}
			style={mergedStyle}
			width={dim}
			height={dim}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width={strokeWidth}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden={ariaLabel ? undefined : true}
			aria-label={ariaLabel}
			role={ariaLabel ? 'img' : undefined}
			focusable={focusable ? 'true' : 'false'}
		>
			{PATHS[name]}
		</svg>
	);
}

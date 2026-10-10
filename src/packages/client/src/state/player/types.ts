import type { EntityRef, MediaKind } from '@mu/shared';

/**
 * Identifiers for the player toolbar's control groups. `PlayerControls`
 * renders whichever groups the active adapter lists, in that order, placing
 * them into fixed zones:
 *
 *  - `seek`      → the full-width seek row
 *  - `title`     → the left section (title + timing; split mode shows timing only)
 *  - `transport` → the centre (skip back / play / skip forward)
 *  - everything else → the right-hand button cluster, in list order
 */
export type ControlGroupId =
	| 'seek'
	| 'title'
	| 'transport'
	| 'plugins'
	| 'snippet'
	| 'sharedSession'
	| 'info'
	| 'queue'
	| 'effects'
	| 'volume'
	| 'settings'
	| 'mobileOverflow'
	| 'pip'
	| 'fullscreen';

/** A collapsible side / list panel an adapter offers (queue, info, lyrics, …). */
export interface PanelSpec {
	id: string;
	label: string;
}

/** Display metadata for whatever is currently loaded, independent of kind. */
export interface NowPlayingMeta {
	ref: EntityRef;
	title: string;
	subtitle?: string | null;
	artUrl?: string | null;
	links?: { label: string; href: string }[];
}

export interface PlayMediaOptions {
	/** Ignore any saved resume position and start at 0. */
	fromBeginning?: boolean;
}

/**
 * Kind-specific behaviour plugged into the single player shell.
 * See docs/music-support-plan.md §6.4.
 */
export interface PlayerAdapter {
	kind: MediaKind;
	/** Fetch title / art / links for the now-playing UI. */
	loadMeta(ref: EntityRef): Promise<NowPlayingMeta>;
	/** Create the server stream session for `ref`. */
	startStream(ref: EntityRef): Promise<unknown>;
	/** Natural end of playback (video: next in queue; audio: gapless advance). */
	onEnded(): void;
	/** Ordered control groups for the toolbar. */
	toolbar: ControlGroupId[];
	/** Collapsible side / list panels. */
	panels: PanelSpec[];
	/** What fills the stage / mini corner. */
	surface: 'video' | 'artwork';
}

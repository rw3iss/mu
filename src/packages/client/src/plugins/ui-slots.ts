/**
 * All valid UI slot positions where plugins can inject content.
 *
 * Usage:
 *   import { UI } from '@/plugins/ui-slots';
 *   context.slots.register(UI.DASHBOARD_TOP, ({ }) => <MyWidget />);
 */
export const UI = {
	// ── Player ──
	/** Player info panel flyout — appended after core movie info */
	INFO_PANEL: 'INFO_PANEL',
	/** Player control bar — right-side buttons, rendered before system buttons */
	PLAYER_BUTTON: 'PLAYER_BUTTON',

	// ── Movie Detail Page ──
	/** Ratings section — renders alongside IMDb/RT/Metacritic ratings */
	MOVIE_PAGE_RATING: 'MOVIE_PAGE_RATING',
	/** Bottom of movie detail page — after management section */
	MOVIE_PAGE_CONTENT: 'MOVIE_PAGE_CONTENT',

	// ── Movie Cards / List Items ──
	/** Rating area on MovieCard, MovieLargeCard, MovieListItem */
	MOVIE_ITEM_RATING: 'MOVIE_ITEM_RATING',

	// ── Dashboard ──
	/** Top of dashboard, before all sections */
	DASHBOARD_TOP: 'DASHBOARD_TOP',
	/** Bottom of dashboard, after all sections */
	DASHBOARD_BOTTOM: 'DASHBOARD_BOTTOM',

	// ── Library ──
	/** After the toolbar, before the movie grid */
	LIBRARY_TOOLBAR: 'LIBRARY_TOOLBAR',
	/** After the movie grid and pagination */
	LIBRARY_BOTTOM: 'LIBRARY_BOTTOM',

	// ── History ──
	/** After the history grid */
	HISTORY_BOTTOM: 'HISTORY_BOTTOM',

	// ── Playlists ──
	/** After the playlists grid/list */
	PLAYLISTS_BOTTOM: 'PLAYLISTS_BOTTOM',
	/** After the movie list on playlist detail page */
	PLAYLIST_DETAIL_BOTTOM: 'PLAYLIST_DETAIL_BOTTOM',

	// ── Settings ──
	/** Custom settings section at the bottom of the settings page */
	SETTINGS_BOTTOM: 'SETTINGS_BOTTOM',
} as const;

/** Union type of all valid slot names */
export type UISlotName = (typeof UI)[keyof typeof UI];

/** All valid slot names as an array (for validation) */
export const UI_SLOT_NAMES = Object.values(UI) as UISlotName[];

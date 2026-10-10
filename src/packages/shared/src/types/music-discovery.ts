import type { MusicSearchKind } from './search.js';

/** A discovery seed: a local id, or `mb:<mbid>` for a MusicBrainz entity. */
export interface MusicDiscoverSeed {
	type: MusicSearchKind;
	id: string;
	/** Display label (client convenience; the server re-resolves). */
	label?: string;
}

export interface MusicDiscoverFilters {
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	inLibraryOnly?: boolean;
}

export interface MusicDiscoverRequest {
	seeds: MusicDiscoverSeed[];
	filters?: MusicDiscoverFilters;
	/** Max items per group (default 24, max 60). */
	limit?: number;
}

export interface MusicDiscoverItem {
	kind: MusicSearchKind;
	localId?: string;
	mbid?: string;
	title: string;
	artist?: string;
	year?: number;
	artUrl?: string;
	inLibrary: boolean;
	/** Blended score, 0..1. */
	score: number;
	reasons: string[];
	/** Strategies that proposed this item. */
	strategies: string[];
}

export interface MusicDiscoverStrategyStatus {
	name: string;
	ok: boolean;
	count: number;
	error?: string;
}

export interface MusicDiscoverResponse {
	artists: MusicDiscoverItem[];
	albums: MusicDiscoverItem[];
	tracks: MusicDiscoverItem[];
	strategies: MusicDiscoverStrategyStatus[];
}

/** Suggested seeds for the Discover page (favourites + recent listening). */
export interface MusicDiscoverSeedSuggestion extends MusicDiscoverSeed {
	label: string;
	subtitle?: string;
	artUrl?: string | null;
	origin: 'favorite' | 'history';
}

export interface MbTrackPreview {
	position: number | null;
	title: string;
	lengthMs: number | null;
	artist: string | null;
}

/** MusicBrainz release-group preview for `/album/mb:<mbid>` stub pages. */
export interface MbReleaseGroupPreview {
	mbid: string;
	title: string;
	primaryType: string | null;
	secondaryTypes: string[];
	year: number | null;
	artist: string | null;
	artistMbid: string | null;
	genres: string[];
	/** Cover Art Archive front image (may 404 — render with a fallback). */
	coverUrl: string;
	url: string;
	/** Tracklist of one representative release (empty when unavailable). */
	tracks: MbTrackPreview[];
	/** Set when this release group is already in the library. */
	localAlbumId: string | null;
}

/** MusicBrainz artist preview for `/artist/mb:<mbid>` stub pages. */
export interface MbArtistPreview {
	mbid: string;
	name: string;
	type: string | null;
	country: string | null;
	beginYear: number | null;
	endYear: number | null;
	disambiguation: string | null;
	genres: string[];
	url: string;
	releaseGroups: {
		mbid: string;
		title: string;
		year: number | null;
		primaryType: string | null;
		coverUrl: string;
		localAlbumId: string | null;
	}[];
	localArtistId: string | null;
}

/** A library movie this album is the soundtrack of. */
export interface AlbumFilmLink {
	movieId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	/** How the match was made. */
	via: 'soundtrack-cache' | 'title-year';
}

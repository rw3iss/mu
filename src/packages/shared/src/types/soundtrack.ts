/**
 * Movie soundtrack listing (the released score/song album + its tracks),
 * sourced from MusicBrainz. This is the album tracklist — NOT the
 * songs-used-in-each-scene data (which has no free API).
 */

export interface SoundtrackTrack {
	/** 1-based position within the release (null if unknown). */
	position: number | null;
	title: string;
	/** Track length in milliseconds (null if unknown). */
	lengthMs: number | null;
	/** Performing artist / composer for the track, when distinct. */
	artist?: string | null;
}

export interface SoundtrackRelease {
	/** MusicBrainz release MBID. */
	mbid: string;
	title: string;
	/** Album artist (often the composer). */
	artist?: string | null;
	/** Release date (YYYY or YYYY-MM-DD). */
	date?: string | null;
	trackCount: number;
	tracks: SoundtrackTrack[];
	/** Link to the release on MusicBrainz. */
	url: string;
}

export interface SoundtrackDto {
	movieId: string;
	found: boolean;
	release: SoundtrackRelease | null;
	source: 'musicbrainz';
	/** ISO timestamp of when this result was fetched/cached. */
	fetchedAt: string;
}

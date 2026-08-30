/** Result from a third-party subtitle search */
export interface SubtitleSearchResult {
	/** Provider-specific file ID (used for download) */
	fileId: string;
	/** Which provider returned this result */
	provider: 'opensubtitles' | 'subdl';
	/** Language code (ISO 639-1 or 639-2) */
	language: string;
	/** Human-readable label */
	label: string;
	/** Download count / popularity indicator */
	downloads?: number;
	/** Whether this is hearing-impaired */
	hearingImpaired?: boolean;
	/** Whether the result was matched by file hash */
	hashMatch?: boolean;
	/** Release/file name info */
	releaseName?: string;
	/** Subtitle format (srt, vtt, ass, etc.) */
	format?: string;
}

/** Request to search for subtitles */
export interface SubtitleSearchQuery {
	movieId: string;
	language?: string;
}

/** Info about an existing subtitle file for a movie */
export interface MovieSubtitleInfo {
	index: number;
	language: string;
	label: string;
	codec?: string;
	forced?: boolean;
	external?: boolean;
	/** Marked as this movie's default subtitle (persisted server-side). */
	default?: boolean;
	/** Source sidecar filename (external tracks) — shown on hover to
	 * distinguish multiple downloads of the same language. */
	fileName?: string;
	/**
	 * For provider downloads: the exact `<provider>:<fileId>` this sidecar came
	 * from. Unique per search result, so the search list can flag precisely the
	 * one result already on disk (release names are often duplicated).
	 */
	sourceId?: string;
	/** Available when there's an active stream session */
	url?: string;
}

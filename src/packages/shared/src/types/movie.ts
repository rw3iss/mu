export interface Movie {
	id: string;
	title: string;
	originalTitle?: string;
	year?: number;
	overview?: string;
	tagline?: string;
	runtimeMinutes?: number;
	releaseDate?: string;
	language?: string;
	country?: string;
	posterUrl?: string;
	backdropUrl?: string;
	trailerUrl?: string;
	imdbId?: string;
	tmdbId?: number;
	contentRating?: string;
	addedAt: string;
	updatedAt: string;
}

export interface MovieWithDetails extends Movie {
	metadata?: MovieMetadata;
	files?: MovieFile[];
	userRating?: number;
	watched?: boolean;
	watchProgress?: number;
	inWatchlist?: boolean;
}

export interface MovieMetadata {
	id: string;
	movieId: string;
	genres: string[];
	cast: CastMember[];
	directors: string[];
	writers: string[];
	keywords: string[];
	productionCompanies: string[];
	budget?: number;
	revenue?: number;
	imdbRating?: number;
	imdbVotes?: number;
	tmdbRating?: number;
	tmdbVotes?: number;
	rottenTomatoesScore?: number;
	metacriticScore?: number;
	extendedData?: Record<string, unknown>;
	source?: string;
	fetchedAt: string;
	updatedAt: string;
}

export interface CastMember {
	name: string;
	character?: string;
	profileUrl?: string;
	tmdbId?: number;
}

export interface MovieFile {
	id: string;
	movieId: string;
	sourceId: string;
	filePath: string;
	fileName: string;
	fileSize: number;
	fileHash?: string;
	resolution?: string;
	codecVideo?: string;
	codecAudio?: string;
	bitrate?: number;
	durationSeconds?: number;
	videoWidth?: number;
	videoHeight?: number;
	videoBitDepth?: number;
	videoFrameRate?: string;
	videoProfile?: string;
	videoColorSpace?: string;
	hdr?: boolean;
	containerFormat?: string;
	subtitleTracks: SubtitleTrack[];
	audioTracks: AudioTrack[];
	available: boolean;
	addedAt: string;
	fileModifiedAt?: string;
}

/** A playable video version of a movie (File Info → Video → Versions). */
export interface VideoVersion {
	/** `<fileId>`, `<fileId>:copy` (cached direct copy) or `<fileId>:original`. */
	id: string;
	fileId: string;
	kind: 'file' | 'copy' | 'original';
	fileName: string;
	codec: string | null;
	width: number | null;
	height: number | null;
	bitDepth: number | null;
	hdr: boolean;
	sizeBytes: number | null;
	/** Plays now (admin default, else the automatic pick). */
	isDefault: boolean;
	/** An admin chose it. */
	explicit: boolean;
}

export interface FileInfo {
	/** movie_files id of the file described. */
	id?: string;
	versions?: VideoVersion[];
	containerFormat?: string;
	codecVideo?: string;
	codecAudio?: string;
	resolution?: string;
	videoWidth?: number;
	videoHeight?: number;
	videoBitDepth?: number;
	videoFrameRate?: string;
	videoProfile?: string;
	videoColorSpace?: string;
	hdr?: boolean;
	bitrate?: number;
	fileSize?: number;
	fileName?: string;
	audioTracks: AudioTrack[];
	subtitleTracks: SubtitleTrack[];
}

export interface SubtitleTrack {
	index: number;
	language?: string;
	title?: string;
	codec?: string;
	forced?: boolean;
	external?: boolean;
	filePath?: string;
}

export interface AudioTrack {
	index: number;
	language?: string;
	title?: string;
	codec: string;
	channels?: number;
	channelLayout?: string;
	sampleRate?: number;
	bitDepth?: number;
	/** The movie's default audio track (set on the movie page). */
	default?: boolean;
}

export interface MediaSource {
	id: string;
	path: string;
	label?: string;
	scanIntervalHours: number;
	enabled: boolean;
	lastScannedAt?: string;
	fileCount: number;
	totalSizeBytes: number;
	createdAt: string;
	updatedAt: string;
}

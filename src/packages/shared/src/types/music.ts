import type { EntityRef } from './media.js';

/** Audio streaming quality profiles. See docs/music-support-plan.md §5.4. */
export type AudioQuality = 'original' | 'lossless' | 'high' | 'normal' | 'low';
export const AUDIO_QUALITIES: readonly AudioQuality[] = ['original', 'lossless', 'high', 'normal', 'low'];
/** Ordered best → worst, for "cap at admin maximum" comparisons. */
export function audioQualityRank(p: AudioQuality): number {
	return AUDIO_QUALITIES.indexOf(p);
}

export type ReplayGainMode = 'off' | 'track' | 'album';
export type RepeatMode = 'off' | 'all' | 'one';

export interface ArtistSummary {
	id: string;
	name: string;
	imageUrl: string | null;
	albumCount?: number;
	trackCount?: number;
}

export interface AlbumSummary {
	id: string;
	title: string;
	artistCredit: string | null;
	artists: { id: string; name: string }[];
	year: number | null;
	primaryType: string | null;
	artUrl: string | null;
	trackCount: number;
	totalSeconds: number;
	ratingAvg: number | null;
	addedAt: string;
}

export interface TrackFileInfo {
	id: string;
	container: string | null;
	codec: string | null;
	bitrate: number | null;
	sampleRate: number | null;
	bitDepth: number | null;
	channels: number | null;
	lossless: boolean;
	fileSize: number | null;
	fileName: string;
}

export interface TrackSummary {
	id: string;
	title: string;
	albumId: string;
	albumTitle: string;
	artistCredit: string | null;
	artists: { id: string; name: string; role: string }[];
	discNo: number;
	trackNo: number | null;
	durationSeconds: number | null;
	artUrl: string | null;
	ratingAvg: number | null;
	userRating?: number | null;
	playCount: number;
}

export interface ArtistDetail extends ArtistSummary {
	sortName: string;
	type: string | null;
	country: string | null;
	beginYear: number | null;
	endYear: number | null;
	disambiguation: string | null;
	bio: string | null;
	genres: string[];
	mbid: string | null;
	albums: AlbumSummary[];
	appearsOn: AlbumSummary[];
	popularTracks: TrackSummary[];
	userRating?: number | null;
}

export interface AlbumDetail extends AlbumSummary {
	mbidReleaseGroup: string | null;
	secondaryTypes: string[];
	isCompilation: boolean;
	originalYear: number | null;
	genres: string[];
	label: string | null;
	releases: { id: string; label: string | null; country: string | null; releaseDate: string | null; mediaFormat: string | null }[];
	tracks: TrackSummary[];
	userRating?: number | null;
}

export interface TrackDetail extends TrackSummary {
	mbidRecording: string | null;
	isrc: string | null;
	files: TrackFileInfo[];
	lyrics: { plain: string | null; syncedLrc: string | null; source: string | null } | null;
	appearsOn: AlbumSummary[];
	credits: { artistId: string; name: string; role: string }[];
}

/** Admin music settings blob (app setting key `music`). */
export interface MusicSettings {
	minDurationSeconds: number;
	grouping: 'tags' | 'folder' | 'tags+folder';
	artPreference: ('embedded' | 'folder' | 'coverartarchive')[];
	defaultProfile: AudioQuality;
	maxProfile: AudioQuality;
	transcodeUnplayableAtIngest: boolean;
	flacCompressionLevel: number;
	bitrates: { high: number; normal: number; low: number };
	maxConcurrentJobs: number;
	transcodeCacheMaxGb: number;
	onDemandMaxSeconds: number;
	replayGain: ReplayGainMode;
	gapless: boolean;
	crossfadeSeconds: number;
	resumeAfterVideo: boolean;
	offline: {
		allowDownloads: boolean;
		downloadProfile: AudioQuality;
		maxOfflineGbPerDevice: number;
		roles: ('admin' | 'contributor' | 'viewer')[];
	};
	fetchLyrics: boolean;
	waveforms: boolean;
}

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = {
	minDurationSeconds: 5,
	grouping: 'tags+folder',
	artPreference: ['embedded', 'folder', 'coverartarchive'],
	defaultProfile: 'original',
	maxProfile: 'original',
	transcodeUnplayableAtIngest: true,
	flacCompressionLevel: 5,
	bitrates: { high: 256, normal: 160, low: 96 },
	maxConcurrentJobs: 2,
	transcodeCacheMaxGb: 20,
	onDemandMaxSeconds: 1200,
	replayGain: 'off',
	gapless: true,
	crossfadeSeconds: 0,
	resumeAfterVideo: true,
	offline: {
		allowDownloads: true,
		downloadProfile: 'high',
		maxOfflineGbPerDevice: 10,
		roles: ['admin', 'contributor', 'viewer'],
	},
	fetchLyrics: true,
	waveforms: true,
};

/** Precomputed peaks for the waveform seek bar (normalised 0..1). */
export interface WaveformData {
	trackFileId: string;
	samplesPerSecond: number;
	peaks: number[];
}

/** Stream session for audio, returned by GET /music/stream/:trackId/start. */
export interface AudioStreamSession {
	sessionId: string;
	ref: EntityRef;
	trackFileId: string;
	streamUrl: string;
	profile: AudioQuality;
	/** True when the bytes are the untouched original file. */
	original: boolean;
	codec: string | null;
	durationSeconds: number | null;
	startPosition: number;
	replayGainTrack: number | null;
	replayGainAlbum: number | null;
	waveformUrl: string | null;
}

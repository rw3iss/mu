import type { Movie } from '@/state/library.state';

const BROWSER_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'flac', 'vorbis', 'mp4a', 'pcm_s16le'];
const TRANSCODE_AUDIO_CODECS = ['dts', 'truehd', 'ac3', 'eac3', 'dca', 'mlp'];

/**
 * Client-side approximation of the server's stream mode decision.
 * Returns 'direct_play', 'direct_stream', or 'transcode'.
 */
export function getStreamMode(movie: Movie): string | null {
	const fi = movie.fileInfo;
	if (!fi) return null;

	const videoCodec = (fi.codecVideo || '').toLowerCase();
	const audioCodec = (fi.codecAudio || '').toLowerCase();
	const container = (fi.containerFormat || '').toLowerCase();
	const fileName = (fi.fileName || '').toLowerCase();

	// Determine container from format or filename extension
	const ext = fileName.slice(fileName.lastIndexOf('.'));
	const isMp4 = container === 'mp4' || container === 'mov' || ext === '.mp4' || ext === '.m4v';
	const isMkv = container === 'matroska' || ext === '.mkv';
	const isWebm = container === 'webm' || ext === '.webm';
	const isBrowserContainer = isMp4 || isWebm;

	const isH264 = videoCodec === 'h264' || videoCodec === 'avc' || videoCodec === 'h.264';
	const isBrowserAudio = !audioCodec || BROWSER_AUDIO_CODECS.some((c) => audioCodec.includes(c));
	const needsAudioTranscode = TRANSCODE_AUDIO_CODECS.some((c) => audioCodec.includes(c));

	if (videoCodec) {
		if (isH264 && isBrowserContainer && isBrowserAudio && !needsAudioTranscode) {
			return 'direct_play';
		}
		if (isH264 && isMkv && isBrowserAudio && !needsAudioTranscode) {
			return 'direct_stream';
		}
		if (isH264 && needsAudioTranscode) return 'transcode';
		return 'transcode';
	}

	if (isMp4 || isWebm) return 'direct_play';
	return 'transcode';
}

/**
 * Whether this movie needs any form of transcoding/remuxing (not direct play).
 */
export function needsTranscode(movie: Movie): boolean {
	const mode = getStreamMode(movie);
	return mode !== null && mode !== 'direct_play';
}

/**
 * Get a human-readable label for the stream mode.
 */
export function getStreamModeLabel(movie: Movie): string | null {
	const mode = getStreamMode(movie);
	if (!mode) return null;
	switch (mode) {
		case 'direct_play':
			return 'Direct Play';
		case 'direct_stream':
			return 'Remux';
		case 'transcode':
			return 'Transcode';
		default:
			return mode;
	}
}

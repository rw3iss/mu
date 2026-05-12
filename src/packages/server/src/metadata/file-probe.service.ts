import { basename } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';

/**
 * Structured codec info derived from FFprobe output. Mirrors the columns
 * we persist on `movie_files`, plus the audio/subtitle track arrays.
 */
export interface FileCodecInfo {
	codecVideo?: string;
	codecAudio?: string;
	resolution?: string;
	durationSeconds?: number;
	bitrate?: number;
	videoWidth?: number;
	videoHeight?: number;
	videoBitDepth?: number;
	videoFrameRate?: string;
	videoProfile?: string;
	videoColorSpace?: string;
	hdr?: boolean;
	containerFormat?: string;
	audioTracks?: Array<{
		index: number;
		codec: string;
		language: string;
		title: string;
		channels: number;
		channelLayout: string;
		sampleRate?: number;
		bitDepth?: number;
	}>;
	subtitleTracks?: Array<{
		index: number;
		codec: string;
		language: string;
		title: string;
		forced: boolean;
		external: boolean;
	}>;
}

/** Raw "exif"-style metadata: format tags + per-stream tags. */
export interface FileRawMetadata {
	formatTags: Record<string, string>;
	streams: Array<{
		index: number;
		codecType?: string;
		codecName?: string;
		width?: number;
		height?: number;
		tags?: Record<string, string>;
	}>;
	format: {
		formatName?: string;
		duration?: number;
		size?: number;
		bitRate?: number;
	};
}

export interface FileProbeResult {
	codecInfo: FileCodecInfo;
	fileMetadata: FileRawMetadata;
}

/**
 * Wraps FFprobe and normalises its output into the structured shapes we
 * persist on `movie_files`. Previously inlined in MetadataController as
 * the 170-line `probeFileFull` method.
 */
@Injectable()
export class FileProbeService {
	private readonly logger = new Logger(FileProbeService.name);

	probe(filePath: string): Promise<FileProbeResult | null> {
		return new Promise((resolve) => {
			ffmpeg.ffprobe(filePath, (err, metadata) => {
				if (err) {
					this.logger.warn(`FFprobe failed for ${basename(filePath)}: ${err.message}`);
					resolve(null);
					return;
				}

				const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
				const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');

				const width = videoStream?.width;
				const height = videoStream?.height;
				let resolution: string | undefined;
				if (height) {
					if (height >= 2160) resolution = '2160p';
					else if (height >= 1080) resolution = '1080p';
					else if (height >= 720) resolution = '720p';
					else if (height >= 480) resolution = '480p';
					else resolution = `${height}p`;
				}

				const colorTransfer = (videoStream as any)?.color_transfer ?? '';
				const colorSpace = (videoStream as any)?.color_space ?? '';
				const hdr =
					colorTransfer === 'smpte2084' ||
					colorTransfer === 'arib-std-b67' ||
					colorSpace === 'bt2020nc' ||
					colorSpace === 'bt2020c';

				const rFrameRate = (videoStream as any)?.r_frame_rate;
				let videoFrameRate: string | undefined;
				if (rFrameRate) {
					const parts = rFrameRate.split('/');
					if (parts.length === 2 && Number(parts[1])) {
						videoFrameRate = (Number(parts[0]) / Number(parts[1])).toFixed(3);
					} else {
						videoFrameRate = rFrameRate;
					}
				}

				const audioStreams = (metadata.streams ?? []).filter(
					(s) => s.codec_type === 'audio',
				);
				const audioTracks = audioStreams.map((s: any, i: number) => ({
					index: i,
					codec: s.codec_name ?? 'unknown',
					language: s.tags?.language ?? 'und',
					title: s.tags?.title ?? `Track ${i + 1}`,
					channels: s.channels ?? 0,
					channelLayout: s.channel_layout ?? '',
					sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
					bitDepth: s.bits_per_raw_sample
						? parseInt(s.bits_per_raw_sample, 10)
						: undefined,
				}));

				const subtitleStreams = (metadata.streams ?? []).filter(
					(s) => s.codec_type === 'subtitle',
				);
				const subtitleTracks = subtitleStreams.map((s: any, i: number) => ({
					index: i,
					codec: s.codec_name ?? 'unknown',
					language: s.tags?.language ?? 'und',
					title: s.tags?.title ?? `Track ${i + 1}`,
					forced: s.disposition?.forced === 1,
					external: false,
				}));

				const codecInfo: FileCodecInfo = {
					codecVideo: videoStream?.codec_name ?? undefined,
					codecAudio: audioStream?.codec_name ?? undefined,
					resolution,
					durationSeconds: metadata.format?.duration
						? Math.round(metadata.format.duration)
						: undefined,
					bitrate: metadata.format?.bit_rate
						? Math.round(Number(metadata.format.bit_rate))
						: undefined,
					videoWidth: width,
					videoHeight: height,
					videoBitDepth: (videoStream as any)?.bits_per_raw_sample
						? parseInt((videoStream as any).bits_per_raw_sample, 10)
						: undefined,
					videoFrameRate,
					videoProfile:
						videoStream?.profile != null ? String(videoStream.profile) : undefined,
					videoColorSpace: colorSpace || undefined,
					hdr,
					containerFormat: metadata.format?.format_name ?? undefined,
					audioTracks,
					subtitleTracks,
				};

				const formatTags: Record<string, string> = {};
				if (metadata.format?.tags) {
					for (const [key, value] of Object.entries(metadata.format.tags)) {
						if (value != null) formatTags[key] = String(value);
					}
				}

				const streams = (metadata.streams ?? []).map((s) => ({
					index: s.index,
					codecType: s.codec_type,
					codecName: s.codec_name,
					width: s.width,
					height: s.height,
					tags: s.tags
						? Object.fromEntries(
								Object.entries(s.tags).map(([k, v]) => [k, String(v)]),
							)
						: undefined,
				}));

				const format = {
					formatName: metadata.format?.format_name,
					duration: metadata.format?.duration,
					size: metadata.format?.size,
					bitRate: metadata.format?.bit_rate
						? Number(metadata.format.bit_rate)
						: undefined,
				};

				resolve({ codecInfo, fileMetadata: { formatTags, streams, format } });
			});
		});
	}
}

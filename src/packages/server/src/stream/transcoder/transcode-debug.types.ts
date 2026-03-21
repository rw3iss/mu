export type DebugVerbosity = 'basic' | 'verbose' | 'trace';

export interface TranscodeDebugEvent {
	timestamp: string;
	elapsed: number;
	type: string;
	detail: string;
	data?: unknown;
}

export interface FFmpegStderrLine {
	timestamp: string;
	line: string;
}

export interface SegmentTiming {
	index: number;
	readyAt: string;
	elapsed: number;
	sizeBytes: number;
}

export interface ClientRequestLog {
	timestamp: string;
	type: 'manifest' | 'segment' | 'status';
	segmentIndex?: number;
	responseCode: number;
	responseTimeMs: number;
}

export interface TranscodeDebugContext {
	sessionId: string;
	movieFileId: string;
	startedAt: string;
	endedAt?: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';

	source: {
		filePath: string;
		codecVideo?: string;
		codecAudio?: string;
		resolution?: string;
		durationSeconds?: number;
		fileSizeBytes?: number;
	};

	encoding: {
		quality?: string;
		preset?: string;
		hwAccel?: string;
		videoCodec?: string;
		rateControl?: string;
		crf?: number;
		mode?: string;
	};

	ffmpeg: {
		commandLine?: string;
		stderrLines: FFmpegStderrLine[];
		lastSpeed?: string;
		lastFps?: string;
	};

	timing: {
		requestReceived?: number;
		ffmpegSpawned?: number;
		firstSegmentReady?: number;
		firstSegmentServed?: number;
	};

	segments: SegmentTiming[];
	segmentCount: number;
	totalSegmentBytes: number;

	performance: {
		avgSegmentTimeMs?: number;
		peakFps?: number;
		peakSpeed?: number;
	};

	clientRequests: ClientRequestLog[];
	manifestRequests: number;
	segmentRequests: number;
	retryCount: number;

	chunkState?: unknown;

	events: TranscodeDebugEvent[];
	errors: string[];
}

export interface TranscodeDebugSummary {
	sessionId: string;
	movieFileId: string;
	status: string;
	startedAt: string;
	endedAt?: string;
	quality?: string;
	segmentCount: number;
	errorCount: number;
	lastSpeed?: string;
	lastFps?: string;
}

/** Status of an individual chunk */
export type ChunkStatus = 'pending' | 'encoding' | 'complete' | 'failed';

/** Priority levels for chunk scheduling */
export const CHUNK_PRIORITY = {
	/** User is actively waiting for this chunk (seek target) */
	SEEK: 1,
	/** Next few chunks after seek target (lookahead) */
	LOOKAHEAD: 5,
	/** Normal sequential pre-transcode order */
	SEQUENTIAL: 20,
	/** Deprioritized chunks (not currently needed) */
	BACKGROUND: 40,
} as const;

/** Information about a single chunk */
export interface ChunkInfo {
	/** 0-based chunk index */
	index: number;
	/** Start time in seconds within the source file */
	startTime: number;
	/** Duration of this chunk in seconds */
	duration: number;
	/** Current transcoding status */
	status: ChunkStatus;
	/** Number of times this chunk has been attempted */
	attempts: number;
	/** Output segment filename (e.g. "segment_0042.ts") */
	segmentFile: string;
}

/** In-memory chunk map for a movie+quality combination */
export interface ChunkMap {
	movieFileId: string;
	quality: string;
	filePath: string;
	totalChunks: number;
	chunkDuration: number;
	movieDuration: number;
	encodingSettingsHash: string;
	chunks: ChunkInfo[];
}

/** Persisted metadata written to chunk-meta.json */
export interface ChunkMetadata {
	movieFileId: string;
	quality: string;
	filePath: string;
	totalChunks: number;
	chunkDuration: number;
	movieDuration: number;
	encodingSettingsHash: string;
	createdAt: string;
}

/** Internal priority queue entry */
export interface ChunkTask {
	movieFileId: string;
	quality: string;
	chunkIndex: number;
	priority: number;
	requestedAt: number;
}

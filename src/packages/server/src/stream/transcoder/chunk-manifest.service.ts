import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { ChunkMap } from './chunk-meta.js';

@Injectable()
export class ChunkManifestService {
	private readonly logger = new Logger(ChunkManifestService.name);

	/**
	 * Generate a virtual HLS manifest from chunk state.
	 * Completed chunks get normal entries; pending/encoding chunks get #EXT-X-GAP markers.
	 * This allows HLS.js to show full duration and skip unavailable segments.
	 */
	/**
	 * Generate a VOD-style manifest listing ALL segments.
	 * Segments that aren't cached yet will return 503 when requested,
	 * triggering HLS.js's built-in fragment retry mechanism.
	 * This shows the full movie duration in the seek bar immediately.
	 */
	generateVirtualManifest(chunkMap: ChunkMap): string {
		const lines: string[] = [
			'#EXTM3U',
			'#EXT-X-VERSION:6',
			`#EXT-X-TARGETDURATION:${Math.ceil(chunkMap.chunkDuration)}`,
			'#EXT-X-MEDIA-SEQUENCE:0',
			'#EXT-X-PLAYLIST-TYPE:VOD',
			'#EXT-X-INDEPENDENT-SEGMENTS',
		];

		// List ALL segments — uncached ones return 503 on request
		for (const chunk of chunkMap.chunks) {
			lines.push(`#EXTINF:${chunk.duration.toFixed(3)},`);
			lines.push(chunk.segmentFile);
		}

		lines.push('#EXT-X-ENDLIST');
		return lines.join('\n') + '\n';
	}

	/**
	 * Generate and write the final HLS manifest once all chunks are complete.
	 */
	async writeFinalManifest(chunkMap: ChunkMap, cacheDir: string): Promise<void> {
		const lines: string[] = [
			'#EXTM3U',
			'#EXT-X-VERSION:6',
			`#EXT-X-TARGETDURATION:${Math.ceil(chunkMap.chunkDuration)}`,
			'#EXT-X-MEDIA-SEQUENCE:0',
			'#EXT-X-PLAYLIST-TYPE:VOD',
			'#EXT-X-INDEPENDENT-SEGMENTS',
		];

		for (const chunk of chunkMap.chunks) {
			lines.push(`#EXTINF:${chunk.duration.toFixed(3)},`);
			lines.push(chunk.segmentFile);
		}

		lines.push('#EXT-X-ENDLIST');

		const manifest = lines.join('\n') + '\n';
		await writeFile(path.join(cacheDir, 'stream.m3u8'), manifest);
		this.logger.log(`Final manifest written for ${chunkMap.movieFileId}/${chunkMap.quality}`);
	}
}

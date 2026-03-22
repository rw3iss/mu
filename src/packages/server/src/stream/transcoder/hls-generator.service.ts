import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { GuidResolverService } from '../../common/guid-resolver.service.js';
import { TranscoderService } from './transcoder.service.js';

@Injectable()
export class HlsGeneratorService {
	private readonly logger = new Logger(HlsGeneratorService.name);

	constructor(
		private readonly transcoderService: TranscoderService,
		private readonly guidResolver: GuidResolverService,
	) {}

	/**
	 * Read and return the HLS master manifest (.m3u8) for a given session.
	 * Returns null if the manifest file does not yet exist.
	 */
	async getManifest(sessionId: string, dir?: string): Promise<Buffer | null> {
		const sessionDir = dir || this.transcoderService.getSessionDir(sessionId);
		const manifestPath = path.join(sessionDir, 'stream.m3u8');

		try {
			const data = await readFile(manifestPath);
			return data;
		} catch (err: any) {
			if (err.code === 'ENOENT') {
				this.logger.debug(`Manifest not yet available for session ${this.guidResolver.resolve(sessionId)}`);
				return null;
			}
			this.logger.error(`Error reading manifest for session ${this.guidResolver.resolve(sessionId)}: ${err.message}`);
			throw err;
		}
	}

	/**
	 * Read and return a specific HLS transport stream segment (.ts) for a given session.
	 * Verifies the segment is fully written before serving (checks file size stability).
	 * Returns null if the segment file does not exist after retries.
	 */
	async getSegment(
		sessionId: string,
		segmentNumber: number,
		dir?: string,
	): Promise<Buffer | null> {
		const sessionDir = dir || this.transcoderService.getSessionDir(sessionId);
		const segmentFileName = `segment_${segmentNumber.toString().padStart(4, '0')}.ts`;
		const segmentPath = path.join(sessionDir, segmentFileName);

		// Retry up to 5 times with 1s delay (total 5s wait for live transcoding)
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				const fileStat = await stat(segmentPath);

				// Verify segment is complete: check size stability
				// A segment being written will have a changing size
				if (fileStat.size === 0) {
					if (attempt < 4) {
						await new Promise((r) => setTimeout(r, 1000));
						continue;
					}
					return null;
				}

				// Wait briefly and check size again to ensure FFmpeg finished writing
				if (attempt === 0) {
					await new Promise((r) => setTimeout(r, 100));
					const recheck = await stat(segmentPath);
					if (recheck.size !== fileStat.size) {
						// Still being written — wait and retry
						await new Promise((r) => setTimeout(r, 500));
						continue;
					}
				}

				const data = await readFile(segmentPath);
				return data;
			} catch (err: any) {
				if (err.code === 'ENOENT') {
					if (attempt < 4) {
						await new Promise((r) => setTimeout(r, 1000));
						continue;
					}
					this.logger.debug(
						`Segment ${segmentNumber} not yet available for session ${this.guidResolver.resolve(sessionId)}`,
					);
					return null;
				}
				this.logger.error(
					`Error reading segment ${segmentNumber} for session ${this.guidResolver.resolve(sessionId)}: ${err.message}`,
				);
				throw err;
			}
		}
		return null;
	}
}

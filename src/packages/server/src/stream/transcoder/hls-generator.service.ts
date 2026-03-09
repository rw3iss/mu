import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import path from 'path';
import { TranscoderService } from './transcoder.service.js';

@Injectable()
export class HlsGeneratorService {
  private readonly logger = new Logger(HlsGeneratorService.name);

  constructor(private readonly transcoderService: TranscoderService) {}

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
        this.logger.debug(`Manifest not yet available for session ${sessionId}`);
        return null;
      }
      this.logger.error(`Error reading manifest for session ${sessionId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Read and return a specific HLS transport stream segment (.ts) for a given session.
   * Returns null if the segment file does not exist.
   */
  async getSegment(sessionId: string, segmentNumber: number, dir?: string): Promise<Buffer | null> {
    const sessionDir = dir || this.transcoderService.getSessionDir(sessionId);
    const segmentFileName = `segment_${segmentNumber.toString().padStart(4, '0')}.ts`;
    const segmentPath = path.join(sessionDir, segmentFileName);

    try {
      const data = await readFile(segmentPath);
      return data;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // Not a warning — expected while transcode is still producing segments
        this.logger.debug(
          `Segment ${segmentNumber} not yet available for session ${sessionId}`,
        );
        return null;
      }
      this.logger.error(
        `Error reading segment ${segmentNumber} for session ${sessionId}: ${err.message}`,
      );
      throw err;
    }
  }
}

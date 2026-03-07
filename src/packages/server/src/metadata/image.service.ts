import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ConfigService } from '../config/config.service.js';

@Injectable()
export class ImageService {
  private readonly logger = new Logger('ImageService');
  private readonly cacheDir: string;

  constructor(private readonly config: ConfigService) {
    this.cacheDir = resolve(this.config.get<string>('paths.imageCache', './data/cache/images'));
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async downloadAndCache(url: string, movieId: string, type: string): Promise<string | null> {
    const movieDir = join(this.cacheDir, movieId);
    if (!existsSync(movieDir)) {
      mkdirSync(movieDir, { recursive: true });
    }

    const ext = this.getExtension(url);
    const filePath = join(movieDir, `${type}${ext}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`Failed to download image from ${url}: ${response.status}`);
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);

      this.logger.debug(`Cached image: ${filePath}`);
      return filePath;
    } catch (err: any) {
      this.logger.error(`Error downloading image from ${url}: ${err.message}`);
      return null;
    }
  }

  getImagePath(movieId: string, type: string): string | null {
    const movieDir = join(this.cacheDir, movieId);
    const extensions = ['.jpg', '.jpeg', '.png', '.webp'];

    for (const ext of extensions) {
      const filePath = join(movieDir, `${type}${ext}`);
      if (existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  private getExtension(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.(jpg|jpeg|png|webp)$/i);
      return match?.[1] ? `.${match[1].toLowerCase()}` : '.jpg';
    } catch {
      return '.jpg';
    }
  }
}

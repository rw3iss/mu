import { Controller, Post, Param, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { MetadataService } from './metadata.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movies, movieMetadata } from '../database/schema/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller()
export class MetadataController {
  private readonly logger = new Logger('MetadataController');

  constructor(
    private readonly metadataService: MetadataService,
    private readonly database: DatabaseService,
  ) {}

  @Post('movies/refresh-all')
  @Roles('admin')
  async refreshAll() {
    // Get all movie IDs
    const allMovies = this.database.db.select({ id: movies.id }).from(movies).all();

    // Get movie IDs that already have metadata
    const withMetadata = new Set(
      this.database.db
        .select({ movieId: movieMetadata.movieId })
        .from(movieMetadata)
        .all()
        .map((m) => m.movieId),
    );

    // Filter to movies without metadata
    const movieIds = allMovies.filter((m) => !withMetadata.has(m.id)).map((m) => m.id);
    const movieCount = movieIds.length;

    // Fire off bulk fetch as a background process
    this.metadataService.bulkFetch(movieIds, 2).catch((err) => {
      this.logger.error(`Bulk metadata refresh failed: ${err.message}`);
    });

    return { message: 'Metadata refresh started', movieCount };
  }

  @Post('movies/:id/refresh')
  @Roles('admin')
  async refreshMetadata(@Param('id') movieId: string) {
    const metadata = await this.metadataService.refreshMetadata(movieId);
    return metadata ?? { message: 'No metadata found' };
  }
}

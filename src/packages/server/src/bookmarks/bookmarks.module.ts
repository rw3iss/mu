import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { BookmarksController } from './bookmarks.controller.js';
import { BookmarksService } from './bookmarks.service.js';

@Module({
	imports: [DatabaseModule, MetadataModule],
	controllers: [BookmarksController],
	providers: [BookmarksService],
	exports: [BookmarksService],
})
export class BookmarksModule {}

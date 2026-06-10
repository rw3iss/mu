import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';

/** Movie comments: general/time-anchored comments, replies, reactions. */
@Module({
	imports: [DatabaseModule],
	providers: [CommentsService],
	controllers: [CommentsController],
	exports: [CommentsService],
})
export class CommentsModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';
import { EntityCommentsController } from './entity-comments.controller.js';

/** Entity comments (movies + any EntityRef): general/time-anchored comments, replies, reactions. */
@Module({
	imports: [DatabaseModule, NotificationsModule],
	providers: [CommentsService],
	controllers: [CommentsController, EntityCommentsController],
	exports: [CommentsService],
})
export class CommentsModule {}

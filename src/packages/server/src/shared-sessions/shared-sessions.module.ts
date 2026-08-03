import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SharedSessionsController } from './shared-sessions.controller.js';
import { SharedSessionsService } from './shared-sessions.service.js';

/**
 * Shared Sessions ("watch party"): session lifecycle + chat persistence + ICE
 * config. Injects the @Global EventsGateway (registers a relay authorizer with
 * it on init — callback pattern, no DI cycle) and the @Global ConfigService.
 */
@Module({
	imports: [DatabaseModule, NotificationsModule],
	controllers: [SharedSessionsController],
	providers: [SharedSessionsService],
	exports: [SharedSessionsService],
})
export class SharedSessionsModule {}

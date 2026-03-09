import { Module, Global } from '@nestjs/common';
import { EventsService } from './events.service.js';
import { EventsGateway } from './events.gateway.js';

@Global()
@Module({
	providers: [EventsService, EventsGateway],
	exports: [EventsService, EventsGateway],
})
export class EventsModule {}

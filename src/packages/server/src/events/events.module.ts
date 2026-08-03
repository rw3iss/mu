import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';
import { EventsService } from './events.service.js';
import { WsAuthService } from './ws-auth.service.js';

@Global()
@Module({
	providers: [EventsService, EventsGateway, WsAuthService],
	exports: [EventsService, EventsGateway, WsAuthService],
})
export class EventsModule {}

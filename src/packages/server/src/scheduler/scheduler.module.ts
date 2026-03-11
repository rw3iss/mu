import { Global, Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service.js';

@Global()
@Module({
	providers: [SchedulerService],
	exports: [SchedulerService],
})
export class SchedulerModule {}

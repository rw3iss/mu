import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { StreamModule } from '../stream/stream.module.js';

@Module({
	imports: [StreamModule],
	controllers: [HealthController],
})
export class HealthModule {}

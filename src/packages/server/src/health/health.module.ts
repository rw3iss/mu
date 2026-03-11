import { Module } from '@nestjs/common';
import { StreamModule } from '../stream/stream.module.js';
import { HealthController } from './health.controller.js';

@Module({
	imports: [StreamModule],
	controllers: [HealthController],
})
export class HealthModule {}

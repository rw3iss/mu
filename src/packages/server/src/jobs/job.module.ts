import { Global, Module } from '@nestjs/common';
import { JobController } from './job.controller.js';
import { JobManagerService } from './job-manager.service.js';

@Global()
@Module({
	controllers: [JobController],
	providers: [JobManagerService],
	exports: [JobManagerService],
})
export class JobModule {}

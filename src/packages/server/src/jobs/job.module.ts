import { Module, Global } from '@nestjs/common';
import { JobManagerService } from './job-manager.service.js';
import { JobController } from './job.controller.js';

@Global()
@Module({
	controllers: [JobController],
	providers: [JobManagerService],
	exports: [JobManagerService],
})
export class JobModule {}

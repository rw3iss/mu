import { Global, Module } from '@nestjs/common';
import { UploadsService } from './uploads.service.js';

/** Global so any module (profile, future chat/comments) can inject UploadsService. */
@Global()
@Module({
	providers: [UploadsService],
	exports: [UploadsService],
})
export class UploadsModule {}

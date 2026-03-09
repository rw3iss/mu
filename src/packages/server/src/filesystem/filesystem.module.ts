import { Module } from '@nestjs/common';
import { FilesystemService } from './filesystem.service.js';
import { FilesystemController } from './filesystem.controller.js';

@Module({
	controllers: [FilesystemController],
	providers: [FilesystemService],
	exports: [FilesystemService],
})
export class FilesystemModule {}

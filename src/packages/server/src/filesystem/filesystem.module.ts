import { Module } from '@nestjs/common';
import { FilesystemController } from './filesystem.controller.js';
import { FilesystemService } from './filesystem.service.js';

@Module({
	controllers: [FilesystemController],
	providers: [FilesystemService],
	exports: [FilesystemService],
})
export class FilesystemModule {}

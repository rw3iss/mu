import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { FilesystemService } from './filesystem.service.js';

@Controller('filesystem')
export class FilesystemController {
	constructor(private readonly filesystemService: FilesystemService) {}

	@Get('browse')
	@Roles('admin')
	browse(@Query('path') path?: string) {
		return this.filesystemService.browse(path || '/');
	}

	@Get('validate')
	@Roles('admin')
	validate(@Query('path') path: string) {
		return this.filesystemService.validate(path);
	}
}

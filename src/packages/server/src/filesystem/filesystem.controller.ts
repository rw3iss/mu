import { Controller, Get, Query } from '@nestjs/common';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { FilesystemService } from './filesystem.service.js';

@Controller('filesystem')
export class FilesystemController {
	constructor(private readonly filesystemService: FilesystemService) {}

	@Get('browse')
	@Roles('admin')
	@RequireAction('admin:server')
	browse(@Query('path') path?: string) {
		return this.filesystemService.browse(path || '/');
	}

	@Get('validate')
	@Roles('admin')
	@RequireAction('admin:server')
	validate(@Query('path') path: string) {
		return this.filesystemService.validate(path);
	}
}

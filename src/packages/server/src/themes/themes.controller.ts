import type { ThemeConfig } from '@mu/shared';
import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { ThemesService } from './themes.service.js';

@Controller('themes')
export class ThemesController {
	constructor(private readonly service: ThemesService) {}

	@RequireAction('view:library')
	@Get()
	findAll() {
		return this.service.findAll();
	}

	@RequireAction('view:library')
	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.service.findOne(id);
	}

	@RequireAction('edit:app-settings')
	@Post()
	create(
		@Body()
		body: {
			name: string;
			mode: 'dark' | 'light';
			config: ThemeConfig;
			isDefault?: boolean;
			createdBy?: string;
		},
	) {
		return this.service.create(body);
	}

	@RequireAction('edit:app-settings')
	@Put(':id')
	update(
		@Param('id') id: string,
		@Body()
		body: {
			name?: string;
			mode?: 'dark' | 'light';
			config?: ThemeConfig;
			isDefault?: boolean;
		},
	) {
		return this.service.update(id, body);
	}

	@RequireAction('edit:app-settings')
	@Delete(':id')
	remove(@Param('id') id: string) {
		this.service.remove(id);
		return { success: true };
	}

	@RequireAction('edit:app-settings')
	@Post('import')
	importTheme(@Body() body: { name: string; mode: 'dark' | 'light'; config: unknown }) {
		return this.service.importTheme(body);
	}

	@RequireAction('view:library')
	@Get(':id/export')
	exportTheme(@Param('id') id: string, @Res() reply: FastifyReply) {
		const data = this.service.exportTheme(id);
		const filename = `${data.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.theme.json`;
		reply.header('Content-Disposition', `attachment; filename="${filename}"`);
		reply.header('Content-Type', 'application/json');
		reply.send(data);
	}
}

import type { ThemeConfig } from '@mu/shared';
import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ThemesService } from './themes.service.js';

@Controller('api/v1/themes')
export class ThemesController {
	constructor(private readonly service: ThemesService) {}

	@Get()
	findAll() {
		return this.service.findAll();
	}

	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.service.findOne(id);
	}

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

	@Delete(':id')
	remove(@Param('id') id: string) {
		this.service.remove(id);
		return { success: true };
	}

	@Post('import')
	importTheme(@Body() body: { name: string; mode: 'dark' | 'light'; config: unknown }) {
		return this.service.importTheme(body);
	}

	@Get(':id/export')
	exportTheme(@Param('id') id: string, @Res() reply: FastifyReply) {
		const data = this.service.exportTheme(id);
		const filename = `${data.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.theme.json`;
		reply.header('Content-Disposition', `attachment; filename="${filename}"`);
		reply.header('Content-Type', 'application/json');
		reply.send(data);
	}
}

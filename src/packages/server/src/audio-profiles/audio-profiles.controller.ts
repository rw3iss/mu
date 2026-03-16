import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { AudioProfilesService } from './audio-profiles.service.js';

@Controller('audio-profiles')
export class AudioProfilesController {
	constructor(private readonly service: AudioProfilesService) {}

	@Get()
	findAll(@CurrentUser('id') userId: string) {
		return this.service.findAll(userId);
	}

	@Get(':id')
	findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
		return this.service.findOne(userId, id);
	}

	@Post()
	create(
		@CurrentUser('id') userId: string,
		@Body() body: { name: string; type: string; config: string; isDefault?: boolean },
	) {
		return this.service.create(userId, body);
	}

	@Put(':id')
	update(
		@CurrentUser('id') userId: string,
		@Param('id') id: string,
		@Body() body: { name?: string; config?: string; isDefault?: boolean },
	) {
		return this.service.update(userId, id, body);
	}

	@Delete(':id')
	remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
		this.service.remove(userId, id);
	}
}

import { Controller, Get, Put, Delete, Param, Body } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
	constructor(private readonly settingsService: SettingsService) {}

	@Get()
	@Roles('admin')
	getAll() {
		return this.settingsService.getAll();
	}

	@Get(':key')
	@Roles('admin')
	get(@Param('key') key: string) {
		const value = this.settingsService.get(key);
		return { key, value };
	}

	@Put(':key')
	@Roles('admin')
	set(@Param('key') key: string, @Body() body: { value: unknown }) {
		this.settingsService.set(key, body.value);
		return { key, value: body.value };
	}

	@Put()
	@Roles('admin')
	setBulk(@Body() body: Record<string, unknown>) {
		this.settingsService.setBulk(body);
		return { success: true };
	}

	@Delete(':key')
	@Roles('admin')
	delete(@Param('key') key: string) {
		const deleted = this.settingsService.delete(key);
		return { success: deleted };
	}
}

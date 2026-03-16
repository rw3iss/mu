import { networkInterfaces } from 'node:os';
import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ConfigService } from '../config/config.service.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly configService: ConfigService,
	) {}

	@Get('server-url')
	@Roles('admin')
	getServerUrl() {
		const port = this.configService.get<number>('server.port', 4000);
		const nets = networkInterfaces();
		let ip = '127.0.0.1';
		for (const addrs of Object.values(nets)) {
			if (!addrs) continue;
			for (const addr of addrs) {
				if (addr.family === 'IPv4' && !addr.internal) {
					ip = addr.address;
					break;
				}
			}
			if (ip !== '127.0.0.1') break;
		}
		return { url: `http://${ip}:${port}` };
	}

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

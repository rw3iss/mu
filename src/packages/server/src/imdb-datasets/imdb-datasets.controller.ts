import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ImdbDatasetsService } from './imdb-datasets.service.js';

@Controller('imdb-datasets')
export class ImdbDatasetsController {
	constructor(private readonly service: ImdbDatasetsService) {}

	@Get('status')
	@Roles('admin')
	@RequireAction('admin:datasets')
	getStatus() {
		return {
			enabled: this.service.isEnabled(),
			datasets: this.service.listStatus(),
		};
	}

	@Put('enabled')
	@Roles('admin')
	@RequireAction('admin:datasets')
	setEnabled(@Body() body: { enabled: boolean }) {
		this.service.setEnabled(!!body?.enabled);
		return { enabled: this.service.isEnabled() };
	}

	/**
	 * Enqueue a manual sync. Returns the job id so the UI can subscribe
	 * to progress via the existing job WS channel.
	 */
	@Post('sync')
	@Roles('admin')
	@RequireAction('admin:datasets')
	triggerSync() {
		const jobId = this.service.triggerManualSync();
		return { jobId };
	}
}

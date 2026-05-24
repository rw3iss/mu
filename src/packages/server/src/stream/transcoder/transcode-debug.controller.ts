import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SettingsService } from '../../settings/settings.service.js';
import { TranscodeDebuggerService } from './transcode-debugger.service.js';

@Controller('admin/transcode-debug')
export class TranscodeDebugController {
	constructor(
		private readonly transcodeDebugger: TranscodeDebuggerService,
		private readonly settings: SettingsService,
	) {}

	@Get()
	@Roles('admin')
	@RequireAction('admin:server')
	listSessions() {
		return this.transcodeDebugger.getAllSessions();
	}

	@Get('active')
	@Roles('admin')
	@RequireAction('admin:server')
	listActiveSessions() {
		return this.transcodeDebugger.getActiveSessions();
	}

	@Get(':sessionId')
	@Roles('admin')
	@RequireAction('admin:server')
	getSession(@Param('sessionId') sessionId: string) {
		const session = this.transcodeDebugger.getSession(sessionId);
		if (!session) {
			throw new NotFoundException(`Debug session ${sessionId} not found`);
		}
		return session;
	}

	@Post('enable')
	@Roles('admin')
	@RequireAction('admin:server')
	enable() {
		this.settings.set('encoding.debugTranscoding', true);
		this.transcodeDebugger.refreshConfig();
		return { enabled: true };
	}

	@Post('disable')
	@Roles('admin')
	@RequireAction('admin:server')
	disable() {
		this.settings.set('encoding.debugTranscoding', false);
		this.transcodeDebugger.refreshConfig();
		return { enabled: false };
	}
}

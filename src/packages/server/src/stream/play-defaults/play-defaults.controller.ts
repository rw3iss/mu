import { BadRequestException, Body, Controller, Param, Put } from '@nestjs/common';
import { RequireAction } from '../../common/decorators/require-action.decorator.js';
import { PlayDefaultsService } from './play-defaults.service.js';

/** Movie page → File Info: choose the default video version / audio track. */
@Controller('stream/defaults')
export class PlayDefaultsController {
	constructor(private readonly defaults: PlayDefaultsService) {}

	/** Body `{ version }`: a VideoVersion id, or null for the automatic pick. */
	@RequireAction('edit:movie')
	@Put(':movieId/video')
	setVideo(@Param('movieId') movieId: string, @Body() body: { version?: string | null }) {
		const v = body?.version;
		if (v != null && typeof v !== 'string') throw new BadRequestException('Invalid version');
		this.defaults.setDefaultVideo(movieId, v || null);
		return { success: true };
	}

	/** Body `{ fileId, index }`: the audio track (0-based audio index) to play by default. */
	@RequireAction('edit:movie')
	@Put(':movieId/audio')
	setAudio(@Param('movieId') movieId: string, @Body() body: { fileId?: string; index?: number }) {
		const index = Number(body?.index);
		if (!body?.fileId || !Number.isInteger(index) || index < 0) {
			throw new BadRequestException('fileId and index are required');
		}
		this.defaults.setDefaultAudio(movieId, body.fileId, index);
		return { success: true };
	}
}

import { Controller, Get, Param } from '@nestjs/common';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { SoundtrackService } from './soundtrack.service.js';

@Controller('soundtrack')
export class SoundtrackController {
	constructor(private readonly soundtrack: SoundtrackService) {}

	/** Album tracklist for a movie's soundtrack (MusicBrainz, cached). */
	@RequireAction('view:library')
	@Get(':movieId')
	getSoundtrack(@Param('movieId') movieId: string) {
		return this.soundtrack.getForMovie(movieId);
	}
}

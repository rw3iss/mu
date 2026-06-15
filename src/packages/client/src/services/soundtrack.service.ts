import type { SoundtrackDto } from '@mu/shared';
import { api } from './api';

/** Fetch a movie's soundtrack tracklist (MusicBrainz, server-cached). */
export const soundtrackService = {
	getForMovie(movieId: string): Promise<SoundtrackDto> {
		return api.get<SoundtrackDto>(`/soundtrack/${movieId}`);
	},
};

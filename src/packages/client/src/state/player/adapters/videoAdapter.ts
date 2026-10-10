import type { EntityRef } from '@mu/shared';
import { moviesService } from '@/services/movies.service';
import { playMedia, startGlobalStream } from '@/state/globalPlayer.state';
import { takeNextFromQueue } from '@/state/queue.state';
import { registerPlayerAdapter } from '../registry';
import type { ControlGroupId, NowPlayingMeta, PlayerAdapter } from '../types';

/** The movie toolbar, in the exact order it has always rendered. */
export const VIDEO_TOOLBAR: ControlGroupId[] = [
	'seek',
	'title',
	'transport',
	'plugins',
	'snippet',
	'sharedSession',
	'info',
	'queue',
	'effects',
	'volume',
	'settings',
	'mobileOverflow',
	'pip',
	'fullscreen',
];

export const videoAdapter: PlayerAdapter = {
	kind: 'video',

	async loadMeta(ref: EntityRef): Promise<NowPlayingMeta> {
		const movie = await moviesService.get(ref.id);
		return {
			ref,
			title: movie.title,
			subtitle: movie.year ? String(movie.year) : null,
			artUrl: movie.posterUrl ?? null,
			links: [{ label: 'Details', href: `/movie/${movie.id}` }],
		};
	},

	startStream(ref: EntityRef) {
		return startGlobalStream(ref.id);
	},

	onEnded() {
		// Auto-advance: pop the next queued title and play it. Popping before
		// playing means a title that fails to start can't wedge the queue
		// retrying the same entry forever.
		const next = takeNextFromQueue('video');
		if (next) void playMedia(next.ref, { fromBeginning: true });
	},

	toolbar: VIDEO_TOOLBAR,
	panels: [
		{ id: 'queue', label: 'Queue' },
		{ id: 'info', label: 'Info' },
	],
	surface: 'video',
};

registerPlayerAdapter(videoAdapter);

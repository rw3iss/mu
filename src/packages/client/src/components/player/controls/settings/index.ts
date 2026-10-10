import type { MediaKind } from '@mu/shared';
import { AudioTrackPanel } from './AudioTrackPanel';
import {
	AudioTrackItem,
	CommentBubblesItem,
	QualityItem,
	RecordSnippetItem,
	StartSharedSessionItem,
	SubtitlesItem,
} from './mainItems';
import { QualityPanel } from './QualityPanel';
import { SubtitleManagePanel } from './SubtitleManagePanel';
import { SubtitlesPanel } from './SubtitlesPanel';
import type { SettingsMenuSpec } from './types';

/** The movie settings menu, in its long-standing row order. */
export const VIDEO_SETTINGS_MENU: SettingsMenuSpec = {
	items: [
		{ id: 'quality', Component: QualityItem },
		{ id: 'subtitles', Component: SubtitlesItem },
		{ id: 'comments', Component: CommentBubblesItem },
		{ id: 'snippet', Component: RecordSnippetItem },
		{ id: 'shared-session', Component: StartSharedSessionItem },
		{ id: 'audio-track', Component: AudioTrackItem },
	],
	panels: [
		{ id: 'quality', Component: QualityPanel },
		{ id: 'subtitles', Component: SubtitlesPanel },
		{ id: 'subtitle-manage', Component: SubtitleManagePanel },
		{ id: 'audio', Component: AudioTrackPanel },
	],
};

const SETTINGS_MENUS: Partial<Record<MediaKind, SettingsMenuSpec>> = {
	video: VIDEO_SETTINGS_MENU,
};

const EMPTY_MENU: SettingsMenuSpec = { items: [], panels: [] };

export function getSettingsMenuSpec(kind: MediaKind): SettingsMenuSpec {
	return SETTINGS_MENUS[kind] ?? EMPTY_MENU;
}

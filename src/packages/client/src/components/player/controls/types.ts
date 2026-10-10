import type { StreamSession } from '@/state/player.state';

/** Props every toolbar control group receives from `PlayerControls`. */
export interface ControlGroupProps {
	onTogglePlay: () => void;
	onSeek: (time: number) => void;
	onToggleFullscreen: () => void;
	onToggleInfo: () => void;
	session: StreamSession | null;
	title?: string;
	/** When true, fullscreen button shows maximize icon instead */
	hasMiniThumbnail?: boolean;
	/** When true, renders in compact split-panel layout */
	isSplit?: boolean;
	/** When true (shared session + no control permission), play/skip are disabled. */
	playbackLocked: boolean;
}

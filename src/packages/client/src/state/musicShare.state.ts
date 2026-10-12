import type { MusicShareKind } from '@mu/shared';
import { signal } from '@preact/signals';

export interface MusicShareTarget {
	kind: MusicShareKind;
	/** Track / album / playlist id (absent for `queue`). */
	id?: string;
	/** Track ids for a `queue` snapshot. */
	trackIds?: string[];
	/** For the dialog heading. */
	title?: string;
}

/** What the global share dialog is open for (null = closed). */
export const musicShareTarget = signal<MusicShareTarget | null>(null);

export function openMusicShare(target: MusicShareTarget): void {
	musicShareTarget.value = target;
}

export function closeMusicShare(): void {
	musicShareTarget.value = null;
}

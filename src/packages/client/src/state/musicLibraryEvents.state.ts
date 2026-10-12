import type { MusicLibraryChange } from '@mu/shared';
import { effect, signal } from '@preact/signals';
import { wsService } from '@/services/websocket.service';
import { musicEnabled } from '@/state/features.state';

export interface MusicChange {
	/** Bumps on every server change event; 0 = none yet. */
	version: number;
	all: boolean;
	albumIds: ReadonlySet<string>;
	artistIds: ReadonlySet<string>;
}

/**
 * Latest music-catalogue change from the server (`music:library-changed`,
 * already coalesced server-side). Music pages read `.version` in an effect and
 * refetch in place — so an upload, scan, merge or metadata match shows up
 * without a page reload.
 */
export const musicChange = signal<MusicChange>({
	version: 0,
	all: false,
	albumIds: new Set(),
	artistIds: new Set(),
});

/** Does the latest change touch this album (or any of these albums)? */
export function changeAffects(c: MusicChange, albumIds: readonly string[]): boolean {
	return c.all || albumIds.some((id) => c.albumIds.has(id));
}

let started = false;

/** Subscribe to the `music` channel while Music is enabled. Idempotent. */
export function initMusicLibraryEvents(): void {
	if (started) return;
	started = true;
	wsService.on('music:library-changed', (data) => {
		const d = data as Partial<MusicLibraryChange> | null;
		musicChange.value = {
			version: musicChange.value.version + 1,
			all: d?.all !== false,
			albumIds: new Set(d?.albumIds ?? []),
			artistIds: new Set(d?.artistIds ?? []),
		};
	});
	let subscribed = false;
	effect(() => {
		if (musicEnabled.value && !subscribed) {
			wsService.subscribe('music');
			subscribed = true;
		} else if (!musicEnabled.value && subscribed) {
			wsService.unsubscribe('music');
			subscribed = false;
		}
	});
}

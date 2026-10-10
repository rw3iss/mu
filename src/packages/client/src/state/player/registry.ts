import type { MediaKind } from '@mu/shared';
import type { PlayerAdapter } from './types';

const adapters = new Map<MediaKind, PlayerAdapter>();

/** Register (or replace) the adapter for a media kind. */
export function registerPlayerAdapter(adapter: PlayerAdapter): void {
	adapters.set(adapter.kind, adapter);
}

/** The adapter for a media kind, or undefined when none is registered. */
export function getAdapter(kind: MediaKind): PlayerAdapter | undefined {
	return adapters.get(kind);
}

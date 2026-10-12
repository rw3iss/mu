import { type MusicLibraryChange, WsEvent } from '@mu/shared';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';

/** Coalescing window: a scan or upload batch becomes one client refresh. */
const FLUSH_MS = 1500;

/**
 * Tells clients the music catalogue changed (`WsEvent.MUSIC_LIBRARY_CHANGED`,
 * channel `music`) so open music pages refetch without a reload. Changes are
 * collected and flushed once per window.
 */
@Injectable()
export class MusicEventsService implements OnModuleDestroy {
	private all = false;
	private readonly albumIds = new Set<string>();
	private readonly artistIds = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly events: EventsService) {}

	/** Record a change. No ids = "something changed, refresh everything". */
	changed(ids: { albumIds?: (string | null | undefined)[]; artistIds?: string[] } = {}): void {
		const albums = (ids.albumIds ?? []).filter((x): x is string => !!x);
		if (!albums.length && !ids.artistIds?.length) this.all = true;
		for (const a of albums) this.albumIds.add(a);
		for (const a of ids.artistIds ?? []) this.artistIds.add(a);
		if (!this.timer) {
			this.timer = setTimeout(() => this.flush(), FLUSH_MS);
			this.timer.unref?.();
		}
	}

	private flush(): void {
		this.timer = null;
		const payload: MusicLibraryChange = {
			all: this.all,
			albumIds: [...this.albumIds],
			artistIds: [...this.artistIds],
		};
		this.all = false;
		this.albumIds.clear();
		this.artistIds.clear();
		this.events.emit(WsEvent.MUSIC_LIBRARY_CHANGED, payload);
	}

	onModuleDestroy(): void {
		if (this.timer) clearTimeout(this.timer);
	}
}

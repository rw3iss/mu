import { currentPage, fetchMovies } from '@/state/library.state';
import { wsService } from './websocket.service';

type Callback = () => void;

/**
 * Client-side service that subscribes to library WebSocket events
 * and triggers movie list refreshes when the server reports changes.
 *
 * Call `libraryEvents.start()` to begin listening and
 * `libraryEvents.stop()` to tear down. Multiple start() calls are
 * ref-counted so the subscription stays alive as long as at least
 * one consumer needs it.
 */
class LibraryEventsService {
	private refCount = 0;
	private listeners: Array<{ event: string; handler: (data: unknown) => void }> = [];
	private changeCallbacks = new Set<Callback>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Register an external callback that fires whenever the library changes. */
	onChange(cb: Callback): () => void {
		this.changeCallbacks.add(cb);
		return () => this.changeCallbacks.delete(cb);
	}

	/** Begin listening for library events (ref-counted). */
	start(): void {
		this.refCount++;
		if (this.refCount > 1) return;

		const movieAdded = () => this.scheduleRefresh();
		const movieUpdated = () => this.scheduleRefresh();
		const movieRemoved = () => this.scheduleRefresh();

		this.listeners = [
			{ event: 'library:movie-added', handler: movieAdded },
			{ event: 'library:movie-updated', handler: movieUpdated },
			{ event: 'library:movie-removed', handler: movieRemoved },
		];

		for (const { event, handler } of this.listeners) {
			wsService.on(event, handler);
		}

		wsService.subscribe('library');
	}

	/** Stop listening (ref-counted). */
	stop(): void {
		this.refCount = Math.max(0, this.refCount - 1);
		if (this.refCount > 0) return;

		for (const { event, handler } of this.listeners) {
			wsService.off(event, handler);
		}
		this.listeners = [];
		wsService.unsubscribe('library');

		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	/**
	 * Debounced refresh — during a bulk scan dozens of movies may arrive
	 * in quick succession; we coalesce into a single fetch.
	 */
	private scheduleRefresh(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			fetchMovies(currentPage.value);
			for (const cb of this.changeCallbacks) {
				try {
					cb();
				} catch {
					/* ignore */
				}
			}
		}, 500);
	}
}

export const libraryEvents = new LibraryEventsService();

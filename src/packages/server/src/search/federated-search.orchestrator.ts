import { Observable } from 'rxjs';
import type {
	SearchCacheService,
	SearchCacheSource,
	SearchCacheType,
} from './search-cache.service.js';
import type { SearchEvent, SearchSource } from './search-types.js';

export const SOURCE_TIMEOUT_MS = 5000;

export interface SearchContext {
	userId?: string;
}

/**
 * One federated search source. Sources declare themselves (id, phase, cache
 * key) and the orchestrator does the rest: ordering, per-source timeout,
 * cache read/write, error isolation and cross-source dedup/merge.
 *
 * - `phase: 'local'` sources run first, sequentially, in list order, with no
 *   timeout and never cached (newly-scanned items must appear immediately).
 * - `phase: 'external'` sources run in parallel after the local phase, each
 *   under the per-source timeout. When `cache` is set, a fresh cache row is
 *   emitted as source `cache` and the upstream call is skipped; fresh upstream
 *   results are written back.
 */
export interface FederatedSearchSource<T> {
	id: SearchSource;
	phase: 'local' | 'external';
	/** Cache coordinates for external sources. Omit to never cache. */
	cache?: { type: SearchCacheType; source: SearchCacheSource };
	/**
	 * Emit (and cache) an empty upstream result instead of dropping it. Kept for
	 * TMDB, which historically emitted + cached empty arrays.
	 */
	keepEmpty?: boolean;
	/** Cheap predicate — false skips the source silently (e.g. no credentials). */
	enabled?: () => boolean;
	/** Resolve hits. `null` means "nothing to say" (e.g. unconfigured) — no emit, no cache. */
	run(
		query: string,
		ctx: SearchContext,
	): Promise<T[] | null | undefined> | T[] | null | undefined;
}

export interface FederatedSearchOptions<T> {
	/**
	 * Dedup keys for a hit, strongest first. Two hits are the same entity when
	 * they share ANY key; every key of a merged hit is indexed, so a local album
	 * keyed only by (artist,title,year) still meets its MusicBrainz twin once
	 * either side contributes the MBID.
	 */
	dedupKeys: (hit: T) => string[];
	merge: (a: T, b: T) => T;
	cache?: Pick<SearchCacheService, 'get' | 'set'>;
	timeoutMs?: number;
}

/**
 * Generic federated search runner shared by movie, people and music search.
 * Emits `results` per source (items already merged with what earlier sources
 * returned), `error` per failing source, then a single `done`.
 */
export function runFederatedSearch<T>(
	query: string,
	ctx: SearchContext,
	sources: FederatedSearchSource<T>[],
	opts: FederatedSearchOptions<T>,
): Observable<SearchEvent<T>> {
	const timeoutMs = opts.timeoutMs ?? SOURCE_TIMEOUT_MS;
	return new Observable((subscriber) => {
		const byKey = new Map<string, { hit: T }>();
		const sourcesQueried: SearchSource[] = [];
		let cancelled = false;

		const note = (source: SearchSource) => {
			if (!sourcesQueried.includes(source)) sourcesQueried.push(source);
		};

		const emitResults = (source: SearchSource, items: T[]) => {
			if (cancelled) return;
			note(source);
			const merged: T[] = [];
			for (const item of items) {
				const keys = opts.dedupKeys(item);
				let slot: { hit: T } | undefined;
				for (const k of keys) {
					slot = byKey.get(k);
					if (slot) break;
				}
				if (slot) slot.hit = opts.merge(slot.hit, item);
				else slot = { hit: item };
				for (const k of opts.dedupKeys(slot.hit)) byKey.set(k, slot);
				for (const k of keys) byKey.set(k, slot);
				merged.push(slot.hit);
			}
			subscriber.next({ kind: 'results', source, items: merged });
		};

		const emitError = (source: SearchSource, err: unknown) => {
			if (cancelled) return;
			note(source);
			subscriber.next({
				kind: 'error',
				source,
				message: err instanceof Error ? err.message : String(err),
			});
		};

		const withTimeout = <R>(p: Promise<R>, source: SearchSource): Promise<R | null> => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			return Promise.race([
				p,
				new Promise<R>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`${source} timed out after ${timeoutMs}ms`)),
						timeoutMs,
					);
				}),
			])
				.catch((err) => {
					emitError(source, err);
					return null;
				})
				.finally(() => clearTimeout(timer));
		};

		const runExternal = async (src: FederatedSearchSource<T>) => {
			if (src.cache && opts.cache) {
				const cached = opts.cache.get<T>(src.cache.type, query, src.cache.source);
				if (cached) {
					emitResults('cache', cached);
					return;
				}
			}
			const items = await withTimeout(
				Promise.resolve().then(() => src.run(query, ctx)),
				src.id,
			);
			if (!items) return;
			if (items.length === 0 && !src.keepEmpty) return;
			emitResults(src.id, items);
			if (src.cache && opts.cache)
				opts.cache.set(src.cache.type, query, src.cache.source, items);
		};

		(async () => {
			const active = sources.filter((s) => {
				try {
					return s.enabled ? s.enabled() : true;
				} catch {
					return false;
				}
			});
			for (const src of active.filter((s) => s.phase === 'local')) {
				if (cancelled) return;
				try {
					const items = await src.run(query, ctx);
					if (items?.length) emitResults(src.id, items);
				} catch (e) {
					emitError(src.id, e);
				}
			}
			await Promise.all(active.filter((s) => s.phase === 'external').map(runExternal));
			if (!cancelled) {
				subscriber.next({ kind: 'done', sourcesQueried });
				subscriber.complete();
			}
		})();

		return () => {
			cancelled = true;
		};
	});
}

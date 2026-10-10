import type {
	MovieSearchHit,
	MusicSearchHit,
	PersonSearchHit,
	SearchEvent,
	SearchSource,
} from '@mu/shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import { musicHitKey } from '@/utils/music-links';

export type SearchStreamType = 'movie' | 'person' | 'music';

type Hit<T extends SearchStreamType> = T extends 'movie'
	? MovieSearchHit
	: T extends 'person'
		? PersonSearchHit
		: MusicSearchHit;

const STREAM_PATH: Record<SearchStreamType, string> = {
	movie: 'movies',
	person: 'people',
	music: 'music',
};

/**
 * Alias keys for a music hit. The server re-emits a hit once a later source
 * adds its MBID, so an earlier copy keyed only by local id must be replaced.
 */
function musicAliases(h: MusicSearchHit): string[] {
	const keys = [musicHitKey(h)];
	if (h.localId) keys.push(`${h.kind}:local:${h.localId}`);
	if (h.mbid) keys.push(`${h.kind}:mb:${h.mbid}`);
	return keys;
}

function movieKey(h: MovieSearchHit): string {
	if (h.imdbId) return `imdb:${h.imdbId}`;
	if (h.tmdbId) return `tmdb:${h.tmdbId}`;
	if (h.movieId) return `local:${h.movieId}`;
	return `slug:${h.title.toLowerCase().replace(/\s+/g, '-')}|${h.year ?? ''}`;
}
function personKey(h: PersonSearchHit): string {
	if (h.tmdbId) return `tmdb:${h.tmdbId}`;
	if (h.traktId) return `trakt:${h.traktId}`;
	return `key:${h.personKey}`;
}

function tierFor(query: string, isOwned: boolean, label: string): number {
	const q = query.toLowerCase();
	const t = label.toLowerCase();
	if (t === q) return isOwned ? 0 : 1;
	if (t.startsWith(q)) return isOwned ? 2 : 3;
	return isOwned ? 4 : 5;
}

export interface UseSearchStreamResult<T extends SearchStreamType> {
	results: Hit<T>[];
	isLoading: boolean;
	sources: SearchSource[];
	error?: string;
}

/**
 * Streams federated search results via SSE. Opens an EventSource for
 * the query, merges results by canonical dedup key as events arrive,
 * and resorts by (tier, matchScore) on each batch. Auto-closes when
 * the server emits the `done` event, on unmount, or on query change.
 */
export function useSearchStream<T extends SearchStreamType>(
	type: T,
	query: string,
): UseSearchStreamResult<T> {
	const [results, setResults] = useState<Hit<T>[]>([]);
	const [isLoading, setLoading] = useState(false);
	const [sources, setSources] = useState<SearchSource[]>([]);
	const [error, setError] = useState<string | undefined>(undefined);
	const esRef = useRef<EventSource | null>(null);

	useEffect(() => {
		esRef.current?.close();
		setResults([]);
		setSources([]);
		setError(undefined);

		if (!query || query.trim().length < 2) {
			setLoading(false);
			return;
		}

		setLoading(true);
		const path = STREAM_PATH[type];
		// EventSource can't set Authorization headers, so the JWT
		// rides along as a query-string token (same pattern HLS.js
		// and subtitle endpoints use). The server's auth guard checks
		// for ?token= before falling back to cookies.
		const token = localStorage.getItem('mu_token');
		const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
		const es = new EventSource(
			`/api/v1/search/${path}/stream?q=${encodeURIComponent(query)}${tokenParam}`,
		);
		esRef.current = es;

		const keyOf = (h: Hit<T>) =>
			type === 'movie'
				? movieKey(h as MovieSearchHit)
				: type === 'person'
					? personKey(h as PersonSearchHit)
					: musicHitKey(h as MusicSearchHit);
		const aliasesOf = (h: Hit<T>): string[] =>
			type === 'music' ? musicAliases(h as MusicSearchHit) : [keyOf(h)];

		es.onmessage = (msg) => {
			let ev: SearchEvent<Hit<T>>;
			try {
				ev = JSON.parse(msg.data) as SearchEvent<Hit<T>>;
			} catch {
				return;
			}
			if (ev.kind === 'results') {
				setSources((prev) => (prev.includes(ev.source) ? prev : [...prev, ev.source]));
				setResults((prev) => {
					const byKey = new Map<string, Hit<T>>();
					for (const h of prev) byKey.set(keyOf(h), h);
					for (const h of ev.items) {
						// Drop earlier copies known under another alias (local id → MBID).
						const aliases = new Set(aliasesOf(h));
						for (const [k, old] of byKey) {
							if (aliasesOf(old).some((a) => aliases.has(a))) byKey.delete(k);
						}
						byKey.set(keyOf(h), h);
					}
					const all = Array.from(byKey.values());
					all.sort((a, b) => {
						const labelA = ((a as any).title ?? (a as any).name ?? '') as string;
						const labelB = ((b as any).title ?? (b as any).name ?? '') as string;
						const tA = tierFor(query, a.isOwned, labelA);
						const tB = tierFor(query, b.isOwned, labelB);
						if (tA !== tB) return tA - tB;
						return (b.matchScore ?? 0) - (a.matchScore ?? 0);
					});
					return all;
				});
			} else if (ev.kind === 'error') {
				setError(`${ev.source}: ${ev.message}`);
			} else if (ev.kind === 'done') {
				setLoading(false);
				es.close();
			}
		};
		es.onerror = () => {
			setError('Search stream interrupted');
			setLoading(false);
			es.close();
		};

		return () => {
			es.close();
		};
	}, [type, query]);

	return { results, isLoading, sources, error };
}

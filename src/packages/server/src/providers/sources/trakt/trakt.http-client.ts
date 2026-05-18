import type { TraktRelatedMovie } from './trakt.types.js';

const TRAKT_BASE = 'https://api.trakt.tv';

export interface TraktHttpClientOptions {
	clientId: string;
}

/**
 * Thin Trakt HTTP wrapper. Sets the required `trakt-api-version: 2`
 * and `trakt-api-key` headers; surfaces 401/429/5xx as typed
 * exceptions so the rate limiter / job runner can handle them
 * appropriately.
 */
export class TraktHttpClient {
	constructor(private readonly options: TraktHttpClientOptions) {}

	async related(idOrSlug: string | number, limit = 10): Promise<TraktRelatedMovie[]> {
		const url = `${TRAKT_BASE}/movies/${encodeURIComponent(String(idOrSlug))}/related?limit=${limit}`;
		const res = await fetch(url, {
			headers: {
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': this.options.clientId,
			},
		});

		if (res.status === 429) {
			const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
			throw Object.assign(new Error('Trakt rate limit hit'), {
				name: 'TraktRateLimit',
				retryAfterMs: retryAfter * 1000,
			});
		}
		if (res.status === 401) {
			throw Object.assign(new Error('Trakt auth failed (check client_id)'), {
				name: 'TraktUnauthorized',
			});
		}
		if (!res.ok) {
			throw new Error(`Trakt /related failed: ${res.status} ${res.statusText}`);
		}
		const data = (await res.json()) as TraktRelatedMovie[];
		return Array.isArray(data) ? data : [];
	}

	/**
	 * Trakt search by external id. Used to resolve a TMDB or IMDB id
	 * to a Trakt slug for downstream calls. Falls back to title search
	 * if no IDs are available.
	 */
	async resolveTraktId(opts: {
		imdb?: string | null;
		tmdb?: number | null;
		title?: string | null;
		year?: number | null;
	}): Promise<{ id: number; slug: string } | null> {
		const { imdb, tmdb, title, year } = opts;
		let url: string | null = null;
		if (imdb) url = `${TRAKT_BASE}/search/imdb/${encodeURIComponent(imdb)}?type=movie`;
		else if (tmdb != null) url = `${TRAKT_BASE}/search/tmdb/${tmdb}?type=movie`;
		else if (title)
			url = `${TRAKT_BASE}/search/movie?query=${encodeURIComponent(title)}${
				year ? `&year=${year}` : ''
			}`;
		if (!url) return null;

		const res = await fetch(url, {
			headers: {
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': this.options.clientId,
			},
		});
		if (!res.ok) return null;
		const arr = (await res.json()) as Array<{
			movie?: { ids: { trakt: number; slug: string } };
		}>;
		const first = arr.find((x) => x.movie);
		if (!first?.movie) return null;
		return { id: first.movie.ids.trakt, slug: first.movie.ids.slug };
	}
}

import { Injectable } from '@nestjs/common';
import { fetchWithTimeout } from '../../common/http/polite-fetch.js';

/**
 * ListenBrainz Labs similar-artists (keyless). Verified 2026-10-10:
 *   GET https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=<mbid,...>&algorithm=<algo>
 *   → [{ artist_mbid, name, comment, type, score, reference_mbid }, …]
 * Throws on HTTP / network errors — the discovery service catches and reports
 * the strategy as failed (fail soft).
 */
const URL_BASE = 'https://labs.api.listenbrainz.org/similar-artists/json';
const ALGORITHM =
	'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SimilarArtist {
	mbid: string;
	name: string;
	comment: string | null;
	score: number;
	referenceMbid: string;
}

@Injectable()
export class ListenBrainzClient {
	/** Small in-process cache: the labs endpoint is slow-ish and results change slowly. */
	private cache = new Map<string, { at: number; items: SimilarArtist[] }>();

	async similarArtists(mbids: string[]): Promise<SimilarArtist[]> {
		const ids = [...new Set(mbids)].slice(0, 5).sort();
		if (!ids.length) return [];
		const key = ids.join(',');
		const hit = this.cache.get(key);
		if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;
		const res = await fetchWithTimeout(
			`${URL_BASE}?artist_mbids=${encodeURIComponent(key)}&algorithm=${ALGORITHM}`,
			{ timeoutMs: TIMEOUT_MS, headers: { Accept: 'application/json' } },
		);
		if (!res.ok) throw new Error(`ListenBrainz ${res.status}`);
		const raw = (await res.json()) as unknown;
		// Older deployments wrapped the list as [{ data: [...] }]; accept both.
		const list: any[] = Array.isArray(raw)
			? raw.length && Array.isArray((raw[0] as any)?.data)
				? (raw[0] as any).data
				: raw
			: [];
		const items = list
			.filter((r) => typeof r?.artist_mbid === 'string' && typeof r?.name === 'string')
			.map((r) => ({
				mbid: r.artist_mbid as string,
				name: r.name as string,
				comment: r.comment || null,
				score: Number(r.score) || 0,
				referenceMbid: String(r.reference_mbid ?? ''),
			}));
		this.cache.set(key, { at: Date.now(), items });
		if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value as string);
		return items;
	}
}

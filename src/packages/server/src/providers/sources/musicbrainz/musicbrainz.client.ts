import { Injectable, Logger } from '@nestjs/common';
import { fetchWithTimeout, Throttle } from '../../../common/http/polite-fetch.js';

/**
 * Shared MusicBrainz client (soundtrack lookups + music metadata).
 *
 * MusicBrainz is keyless but enforces two rules we MUST honour:
 *   1. A descriptive User-Agent (else 403) — set by fetchWithTimeout.
 *   2. ≤ 1 request/second per client. Every call goes through ONE throttle
 *      queue, so soundtrack and music lookups can never add up past the limit.
 *      This works because MusicBrainzModule is a singleton shared by importers.
 *
 * Docs: https://musicbrainz.org/doc/MusicBrainz_API
 */

const BASE_URL = 'https://musicbrainz.org/ws/2';
// 1100ms (not 1000) gives headroom against MB's rolling 1/sec window.
const MIN_INTERVAL_MS = 1100;

export interface MbArtistCredit {
	name: string;
	joinphrase?: string;
	artist?: { id: string; name: string; 'sort-name'?: string; disambiguation?: string };
}

export interface MbReleaseGroupRef {
	id: string;
	title?: string;
	'primary-type'?: string;
	'secondary-types'?: string[];
	'first-release-date'?: string;
}

export interface MbReleaseHit {
	id: string;
	title: string;
	/** Lucene relevance 0–100 (search results only). */
	score?: number;
	date?: string;
	status?: string;
	country?: string;
	'track-count'?: number;
	'artist-credit'?: MbArtistCredit[];
	'release-group'?: MbReleaseGroupRef;
	media?: Array<{ format?: string; 'track-count'?: number }>;
	'label-info'?: Array<{ 'catalog-number'?: string; label?: { name?: string } }>;
}

export interface MbTrack {
	position?: number;
	number?: string;
	title?: string;
	length?: number | null;
	'artist-credit'?: MbArtistCredit[];
	recording?: { id?: string; title?: string; length?: number | null };
}

export interface MbReleaseDetail extends Omit<MbReleaseHit, 'media'> {
	media?: Array<{
		format?: string;
		position?: number;
		'track-count'?: number;
		tracks?: MbTrack[];
	}>;
}

export interface MbTag {
	name: string;
	count?: number;
}

export interface MbReleaseGroupDetail extends MbReleaseGroupRef {
	'artist-credit'?: MbArtistCredit[];
	genres?: MbTag[];
	tags?: MbTag[];
}

export interface MbUrlRelation {
	type: string;
	url?: { resource: string };
}

export interface MbArtistDetail {
	id: string;
	name: string;
	'sort-name'?: string;
	type?: string;
	country?: string;
	disambiguation?: string;
	'life-span'?: { begin?: string; end?: string; ended?: boolean };
	relations?: MbUrlRelation[];
	genres?: MbTag[];
}

@Injectable()
export class MusicBrainzClient {
	private readonly logger = new Logger('MusicBrainzClient');
	/** Exposed so tests can shrink the interval. */
	readonly throttle = new Throttle(MIN_INTERVAL_MS);

	/**
	 * Rate-limited GET returning parsed JSON, or null on any error (404, 5xx,
	 * timeout) — MusicBrainz lookups are best-effort and never throw.
	 */
	get<T>(path: string): Promise<T | null> {
		return this.throttle.run(async () => {
			try {
				const sep = path.includes('?') ? '&' : '?';
				const res = await fetchWithTimeout(`${BASE_URL}${path}${sep}fmt=json`, {
					headers: { Accept: 'application/json' },
				});
				if (!res.ok) {
					if (res.status !== 404)
						this.logger.warn(`MusicBrainz ${res.status} for ${path}`);
					return null;
				}
				return (await res.json()) as T;
			} catch (err) {
				this.logger.warn(`MusicBrainz request failed: ${(err as Error).message}`);
				return null;
			}
		});
	}

	/** Lucene release search. */
	async searchReleases(query: string, limit = 15): Promise<MbReleaseHit[]> {
		const res = await this.get<{ releases?: MbReleaseHit[] }>(
			`/release/?query=${encodeURIComponent(query)}&limit=${limit}`,
		);
		return res?.releases ?? [];
	}

	lookupRelease(
		mbid: string,
		inc = 'recordings+artist-credits+labels+release-groups',
	): Promise<MbReleaseDetail | null> {
		return this.get<MbReleaseDetail>(`/release/${encodeURIComponent(mbid)}?inc=${inc}`);
	}

	lookupReleaseGroup(mbid: string): Promise<MbReleaseGroupDetail | null> {
		return this.get<MbReleaseGroupDetail>(
			`/release-group/${encodeURIComponent(mbid)}?inc=genres+tags+artist-credits`,
		);
	}

	/** Releases in a release group (used to pick a concrete release for a group-level match). */
	async releasesOfGroup(rgMbid: string): Promise<MbReleaseHit[]> {
		const res = await this.get<{ releases?: MbReleaseHit[] }>(
			`/release?release-group=${encodeURIComponent(rgMbid)}&inc=media&limit=50`,
		);
		return res?.releases ?? [];
	}

	lookupArtist(mbid: string): Promise<MbArtistDetail | null> {
		return this.get<MbArtistDetail>(`/artist/${encodeURIComponent(mbid)}?inc=url-rels+genres`);
	}

	/** Artist search by name (for artists with no MBID from tags or a match). */
	async searchArtists(
		name: string,
		limit = 5,
	): Promise<Array<MbArtistDetail & { score?: number }>> {
		const res = await this.get<{ artists?: Array<MbArtistDetail & { score?: number }> }>(
			`/artist/?query=${encodeURIComponent(`artist:"${escapeLucene(name)}"`)}&limit=${limit}`,
		);
		return res?.artists ?? [];
	}
}

/** Display string for an artist credit ("A feat. B"). */
export function creditName(credit?: MbArtistCredit[]): string | null {
	if (!credit || credit.length === 0) return null;
	return (
		credit
			.map((c, i) => `${c.name}${i < credit.length - 1 ? (c.joinphrase ?? ', ') : ''}`)
			.join('')
			.trim() || null
	);
}

/** Escape Lucene special characters in free text for an MB query. */
export function escapeLucene(s: string): string {
	return s.replace(/(["\\+\-!(){}[\]^~*?:/&|])/g, '\\$1');
}

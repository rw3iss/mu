import { Injectable } from '@nestjs/common';
import { fetchWithTimeout, Throttle } from '../../common/http/polite-fetch.js';
import { type NormalizedLyrics, normalizeLrclib } from './lrc.js';

/**
 * Keyless metadata sources for music: LRCLIB (lyrics), Cover Art Archive
 * (album art) and Wikidata/Wikipedia/Commons (artist bio + image). Each has its
 * own polite throttle. Network errors and 5xx THROW (the job fails and is
 * retried later); a clean "not found" returns null so callers can cache misses.
 */

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export interface ImageBytes {
	bytes: Uint8Array;
	mime: string;
}

/** GET an image; null on 404/non-image/oversize, throws on network/5xx. */
async function fetchImage(url: string, timeoutMs = 20_000): Promise<ImageBytes | null> {
	const res = await fetchWithTimeout(url, { timeoutMs });
	if (res.status === 404 || res.status === 400) return null;
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
	if (!mime.startsWith('image/')) return null;
	const len = Number(res.headers.get('content-length') ?? 0);
	if (len > MAX_IMAGE_BYTES) return null;
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
	return { bytes, mime };
}

async function getJson<T>(url: string): Promise<T | null> {
	const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return (await res.json()) as T;
}

// ── LRCLIB ────────────────────────────────────────────────────────────────

const LRCLIB = 'https://lrclib.net/api';

interface LrclibRecord {
	trackName?: string;
	artistName?: string;
	albumName?: string;
	duration?: number;
	instrumental?: boolean;
	plainLyrics?: string | null;
	syncedLyrics?: string | null;
}

export interface LyricsQuery {
	artist: string;
	track: string;
	album?: string | null;
	durationSeconds?: number | null;
}

@Injectable()
export class LrclibClient {
	readonly throttle = new Throttle(300);

	/** Exact lookup (needs duration), then a search fallback. Null = not found. */
	async find(q: LyricsQuery): Promise<NormalizedLyrics | null> {
		if (q.durationSeconds) {
			const params = new URLSearchParams({
				artist_name: q.artist,
				track_name: q.track,
				album_name: q.album ?? '',
				duration: String(Math.round(q.durationSeconds)),
			});
			const rec = await this.throttle.run(() =>
				getJson<LrclibRecord>(`${LRCLIB}/get?${params}`),
			);
			if (rec) return normalizeLrclib(rec);
		}
		const params = new URLSearchParams({ track_name: q.track, artist_name: q.artist });
		const list = await this.throttle.run(() =>
			getJson<LrclibRecord[]>(`${LRCLIB}/search?${params}`),
		);
		const best = pickLrclib(list ?? [], q.durationSeconds ?? null);
		return best ? normalizeLrclib(best) : null;
	}
}

/** Best search hit: duration within 3s when known; prefer synced, then any lyrics. */
export function pickLrclib(list: LrclibRecord[], duration: number | null): LrclibRecord | null {
	const pool = list.filter(
		(r) => duration == null || r.duration == null || Math.abs(r.duration - duration) <= 3,
	);
	return (
		pool.find((r) => r.syncedLyrics) ??
		pool.find((r) => r.plainLyrics) ??
		pool.find((r) => r.instrumental) ??
		null
	);
}

// ── Cover Art Archive ─────────────────────────────────────────────────────

@Injectable()
export class CoverArtClient {
	readonly throttle = new Throttle(500);

	/** Front cover for a release or release group (1200px, falling back to 500px). */
	async front(kind: 'release' | 'release-group', mbid: string): Promise<ImageBytes | null> {
		const base = `https://coverartarchive.org/${kind}/${encodeURIComponent(mbid)}`;
		for (const size of ['front-1200', 'front-500']) {
			const img = await this.throttle.run(() => fetchImage(`${base}/${size}`));
			if (img) return img;
		}
		return null;
	}
}

// ── Wikidata / Wikipedia / Commons ────────────────────────────────────────

interface WikidataEntity {
	entities?: Record<
		string,
		{
			sitelinks?: Record<string, { title?: string }>;
			claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
		}
	>;
}

export interface WikiLinks {
	/** e.g. https://en.wikipedia.org/wiki/Radiohead */
	wikipedia?: string | null;
	/** e.g. https://www.wikidata.org/wiki/Q44190 */
	wikidata?: string | null;
}

@Injectable()
export class WikiClient {
	readonly throttle = new Throttle(500);

	/** sitelinks.enwiki title + P18 image file name for a Wikidata Q-id. */
	async entity(qid: string): Promise<{ enwikiTitle: string | null; imageFile: string | null }> {
		const json = await this.throttle.run(() =>
			getJson<WikidataEntity>(
				`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`,
			),
		);
		const ent = json?.entities ? Object.values(json.entities)[0] : undefined;
		const image = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
		return {
			enwikiTitle: ent?.sitelinks?.enwiki?.title ?? null,
			imageFile: typeof image === 'string' ? image : null,
		};
	}

	/** First-paragraph extract of a Wikipedia article. */
	async summary(lang: string, title: string): Promise<string | null> {
		const json = await this.throttle.run(() =>
			getJson<{ extract?: string; type?: string }>(
				`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
			),
		);
		if (!json || json.type === 'disambiguation') return null;
		return json.extract?.trim() || null;
	}

	commonsImage(file: string): Promise<ImageBytes | null> {
		return this.throttle.run(() =>
			fetchImage(
				`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1000`,
			),
		);
	}

	/** Bio text + image for an artist from its MusicBrainz url-relations. */
	async artistInfo(links: WikiLinks): Promise<{ bio: string | null; image: ImageBytes | null }> {
		let bio: string | null = null;
		let imageFile: string | null = null;
		const qid = links.wikidata?.match(/(Q\d+)/)?.[1] ?? null;
		let wpLang: string | null = null;
		let wpTitle: string | null = null;
		const wp = links.wikipedia?.match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/);
		if (wp?.[1] && wp[2]) {
			wpLang = wp[1];
			wpTitle = decodeURIComponent(wp[2]);
		}
		if (qid) {
			const ent = await this.entity(qid);
			imageFile = ent.imageFile;
			if (!wpTitle && ent.enwikiTitle) {
				wpLang = 'en';
				wpTitle = ent.enwikiTitle;
			}
		}
		if (wpLang && wpTitle) bio = await this.summary(wpLang, wpTitle);
		const image = imageFile ? await this.commonsImage(imageFile) : null;
		return { bio, image };
	}
}

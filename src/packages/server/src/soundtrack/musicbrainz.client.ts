import type { SoundtrackRelease, SoundtrackTrack } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Minimal MusicBrainz client for soundtrack lookups.
 *
 * MusicBrainz is keyless but enforces two rules we MUST honour:
 *   1. A descriptive User-Agent (else 403). See {@link USER_AGENT}.
 *   2. ≤ 1 request/second per client. We serialise all calls through a
 *      single promise chain spaced by {@link MIN_INTERVAL_MS}.
 *
 * Docs: https://musicbrainz.org/doc/MusicBrainz_API
 */

const BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'CineHost-Mu/1.0 ( https://github.com/rw3iss/cinehost )';
// 1100ms (not 1000) gives headroom against MB's rolling 1/sec window.
const MIN_INTERVAL_MS = 1100;
const FETCH_TIMEOUT_MS = 10_000;

interface MbReleaseSearchHit {
	id: string;
	title: string;
	date?: string;
	status?: string;
	'track-count'?: number;
	'artist-credit'?: Array<{ name: string }>;
	'release-group'?: { 'primary-type'?: string; 'secondary-types'?: string[] };
}

@Injectable()
export class MusicBrainzClient {
	private readonly logger = new Logger('MusicBrainzClient');
	/** Tail of the serialised request chain — every call awaits the prior one. */
	private chain: Promise<unknown> = Promise.resolve();
	private lastCallAt = 0;

	/**
	 * Find the best soundtrack release for a movie and return its tracklist.
	 * Returns null when nothing suitable is found.
	 */
	async findSoundtrack(
		title: string,
		year: number | null,
	): Promise<SoundtrackRelease | null> {
		// 1) Search releases tagged as soundtracks matching the movie title.
		const query = `release:"${escapeLucene(title)}" AND secondarytype:soundtrack`;
		const search = await this.request<{ releases?: MbReleaseSearchHit[] }>(
			`/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
		);
		const hits = search?.releases ?? [];
		if (hits.length === 0) return null;

		const best = pickBestRelease(hits, year);
		if (!best) return null;

		// 2) Fetch the chosen release with its recordings (the tracklist).
		const detail = await this.request<MbReleaseDetail>(
			`/release/${best.id}?inc=recordings+artist-credits&fmt=json`,
		);
		if (!detail) return null;

		const tracks = flattenTracks(detail);
		if (tracks.length === 0) return null;

		return {
			mbid: detail.id,
			title: detail.title,
			artist: creditName(detail['artist-credit']) ?? best['artist-credit']?.[0]?.name ?? null,
			date: detail.date ?? best.date ?? null,
			trackCount: tracks.length,
			tracks,
			url: `https://musicbrainz.org/release/${detail.id}`,
		};
	}

	/**
	 * Serialised, rate-limited, timed-out GET returning parsed JSON (or null
	 * on any error — soundtrack lookups are best-effort and must never throw
	 * into the request path).
	 */
	private request<T>(path: string): Promise<T | null> {
		const run = async (): Promise<T | null> => {
			const wait = MIN_INTERVAL_MS - (Date.now() - this.lastCallAt);
			if (wait > 0) await delay(wait);
			this.lastCallAt = Date.now();
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
			try {
				const res = await fetch(`${BASE_URL}${path}`, {
					headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
					signal: controller.signal,
				});
				if (!res.ok) {
					this.logger.warn(`MusicBrainz ${res.status} for ${path}`);
					return null;
				}
				return (await res.json()) as T;
			} catch (err) {
				this.logger.warn(`MusicBrainz request failed: ${(err as Error).message}`);
				return null;
			} finally {
				clearTimeout(timer);
			}
		};
		// Append to the chain so calls never overlap (honours the 1/sec rule).
		const next = this.chain.then(run, run);
		this.chain = next.catch(() => undefined);
		return next as Promise<T | null>;
	}
}

interface MbReleaseDetail {
	id: string;
	title: string;
	date?: string;
	'artist-credit'?: Array<{ name: string }>;
	media?: Array<{
		tracks?: Array<{
			position?: number;
			number?: string;
			title?: string;
			length?: number | null;
			'artist-credit'?: Array<{ name: string }>;
			recording?: { title?: string; length?: number | null };
		}>;
	}>;
}

/**
 * Choose the most appropriate release: prefer Official status and the one
 * whose release year is closest to the film's year (soundtracks usually ship
 * the same year). Falls back to the first hit.
 */
function pickBestRelease(
	hits: MbReleaseSearchHit[],
	year: number | null,
): MbReleaseSearchHit | null {
	const soundtrackHits = hits.filter((h) =>
		h['release-group']?.['secondary-types']?.some((t) => t.toLowerCase() === 'soundtrack'),
	);
	const pool = soundtrackHits.length > 0 ? soundtrackHits : hits;
	const scored = pool.map((h) => {
		let score = 0;
		if (h.status === 'Official') score += 2;
		const hitYear = h.date ? Number.parseInt(h.date.slice(0, 4), 10) : null;
		if (year != null && hitYear != null) {
			const diff = Math.abs(hitYear - year);
			if (diff === 0) score += 3;
			else if (diff <= 1) score += 2;
			else if (diff <= 3) score += 1;
			else score -= 1;
		}
		if ((h['track-count'] ?? 0) > 0) score += 1;
		return { h, score };
	});
	scored.sort((a, b) => b.score - a.score);
	return scored[0]?.h ?? null;
}

function flattenTracks(detail: MbReleaseDetail): SoundtrackTrack[] {
	const out: SoundtrackTrack[] = [];
	for (const medium of detail.media ?? []) {
		for (const t of medium.tracks ?? []) {
			const title = t.title || t.recording?.title;
			if (!title) continue;
			const position =
				t.position ?? (t.number ? Number.parseInt(t.number, 10) || null : null);
			out.push({
				position,
				title,
				lengthMs: t.length ?? t.recording?.length ?? null,
				artist: creditName(t['artist-credit']),
			});
		}
	}
	return out;
}

function creditName(credit?: Array<{ name: string }>): string | null {
	if (!credit || credit.length === 0) return null;
	return credit.map((c) => c.name).join(', ') || null;
}

/** Escape Lucene special characters in a free-text title for the MB query. */
function escapeLucene(s: string): string {
	return s.replace(/(["\\+\-!(){}\[\]^~*?:/])/g, '\\$1');
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

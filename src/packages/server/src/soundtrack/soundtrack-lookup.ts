import type { SoundtrackRelease, SoundtrackTrack } from '@mu/shared';
import {
	escapeLucene,
	type MbReleaseDetail,
	type MbReleaseHit,
	type MusicBrainzClient,
} from '../providers/sources/musicbrainz/musicbrainz.client.js';

/**
 * Find the best soundtrack release for a movie and return its tracklist.
 * Returns null when nothing suitable is found. Uses the shared (throttled)
 * MusicBrainz client.
 */
export async function findSoundtrack(
	mb: MusicBrainzClient,
	title: string,
	year: number | null,
): Promise<SoundtrackRelease | null> {
	// 1) Search releases tagged as soundtracks matching the movie title.
	const query = `release:"${escapeLucene(title)}" AND secondarytype:soundtrack`;
	const hits = await mb.searchReleases(query, 10);
	if (hits.length === 0) return null;

	const best = pickBestRelease(hits, year);
	if (!best) return null;

	// 2) Fetch the chosen release with its recordings (the tracklist).
	const detail = await mb.lookupRelease(best.id, 'recordings+artist-credits');
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
 * Choose the most appropriate release: prefer Official status and the one
 * whose release year is closest to the film's year (soundtracks usually ship
 * the same year). Falls back to the first hit.
 */
export function pickBestRelease(hits: MbReleaseHit[], year: number | null): MbReleaseHit | null {
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

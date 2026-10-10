import type { MusicMatchCandidate } from '@mu/shared';
import {
	creditName,
	escapeLucene,
	type MbReleaseDetail,
	type MbReleaseHit,
} from '../../providers/sources/musicbrainz/musicbrainz.client.js';
import { normKey, titleKey } from '../ingest/normalize.js';

/**
 * Pure album → MusicBrainz release scoring. No I/O, so it is unit-tested
 * directly. Scores are 0..1.
 */

/** Auto-apply a match at or above this score… */
export const AUTO_MATCH_THRESHOLD = 0.8;
/** …and only when the runner-up (from a DIFFERENT release group) trails by this much. */
export const AUTO_MATCH_MARGIN = 0.05;
/** Candidates below this are noise; not stored. */
export const MIN_CANDIDATE_SCORE = 0.35;

export interface LocalAlbum {
	title: string;
	artist: string | null;
	year: number | null;
	trackCount: number;
	/** Track durations in seconds, disc/track order. Empty when unknown. */
	durations: number[];
	various: boolean;
}

export interface ScoredRelease {
	hit: MbReleaseHit;
	score: number;
}

const VARIOUS = new Set(['various artists', 'various', 'va']);

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			const sub = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
			cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, sub);
		}
		prev = cur;
	}
	return prev[b.length] ?? 0;
}

/** Similarity of two normalised strings: max(edit ratio, token Jaccard). */
export function similarity(a: string, b: string): number {
	if (!a && !b) return 1;
	if (!a || !b) return 0;
	if (a === b) return 1;
	const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
	const ta = new Set(a.split(' '));
	const tb = new Set(b.split(' '));
	let inter = 0;
	for (const t of ta) if (tb.has(t)) inter++;
	const jaccard = inter / (ta.size + tb.size - inter);
	return Math.max(edit, jaccard);
}

/** Title similarity, tolerant of "(Remastered)"/"[Deluxe]" noise on either side. */
export function titleSimilarity(local: string, remote: string): number {
	return Math.max(
		similarity(normKey(local), normKey(remote)),
		similarity(titleKey(local), titleKey(remote)),
	);
}

function artistSimilarity(local: LocalAlbum, hit: MbReleaseHit): number {
	const remote = normKey(creditName(hit['artist-credit']) ?? '');
	const remoteVarious = VARIOUS.has(remote);
	if (local.various || !local.artist) return remoteVarious ? 1 : local.various ? 0.3 : 0.5;
	const l = normKey(local.artist);
	if (remoteVarious) return VARIOUS.has(l) ? 1 : 0.2;
	// A credit like "A & B" vs local "A": also compare against each credited artist.
	const each = (hit['artist-credit'] ?? []).map((c) => similarity(l, normKey(c.name)));
	return Math.max(similarity(l, remote), ...each.map((s) => s * 0.9));
}

export function yearOf(date: string | null | undefined): number | null {
	if (!date) return null;
	const y = Number.parseInt(date.slice(0, 4), 10);
	return Number.isFinite(y) && y > 0 ? y : null;
}

function trackCountScore(local: number, remote: number | undefined): number {
	if (!local || remote == null) return 0.5;
	const d = Math.abs(local - remote);
	if (d === 0) return 1;
	if (d === 1) return 0.6;
	if (d <= 3) return 0.25;
	return 0;
}

function yearScore(local: number | null, remote: number | null): number {
	if (local == null || remote == null) return 0.5;
	const d = Math.abs(local - remote);
	if (d === 0) return 1;
	if (d === 1) return 0.7;
	if (d <= 3) return 0.35;
	return 0.1;
}

/** Search-level score for one release hit. */
export function scoreRelease(local: LocalAlbum, hit: MbReleaseHit): number {
	const t = titleSimilarity(local.title, hit.title);
	const a = artistSimilarity(local, hit);
	const tc = trackCountScore(local.trackCount, hit['track-count']);
	const y = yearScore(
		local.year,
		yearOf(hit.date ?? hit['release-group']?.['first-release-date']),
	);
	const official = hit.status === 'Official' ? 1 : hit.status ? 0.3 : 0.6;
	const lucene = (hit.score ?? 50) / 100;
	const s = 0.35 * t + 0.25 * a + 0.15 * tc + 0.1 * y + 0.05 * official + 0.1 * lucene;
	// A bad title or artist can't be rescued by matching track counts.
	const gate = Math.min(t, a) < 0.5 ? 0.6 : 1;
	return round(s * gate);
}

/**
 * Per-track duration agreement (1 = every track within 3s). Null when either
 * side lacks durations or the track counts differ.
 */
export function durationScore(localSeconds: number[], detail: MbReleaseDetail): number | null {
	const remote = (detail.media ?? []).flatMap((m) =>
		(m.tracks ?? []).map((t) => (t.length ?? t.recording?.length ?? null) as number | null),
	);
	if (!localSeconds.length || remote.length !== localSeconds.length) return null;
	let total = 0;
	let n = 0;
	for (let i = 0; i < remote.length; i++) {
		const r = remote[i];
		const l = localSeconds[i];
		if (r == null || !l) continue;
		const delta = Math.abs(r / 1000 - l);
		total += delta <= 3 ? 1 : delta <= 10 ? 0.5 : delta <= 30 ? 0.15 : 0;
		n++;
	}
	return n ? round(total / n) : null;
}

/** Fold duration agreement into a search score (20% weight). */
export function withDurations(score: number, dur: number | null): number {
	return dur == null ? score : round(score * 0.8 + dur * 0.2);
}

export function rankReleases(local: LocalAlbum, hits: MbReleaseHit[]): ScoredRelease[] {
	return hits
		.map((hit) => ({ hit, score: scoreRelease(local, hit) }))
		.sort((a, b) => b.score - a.score);
}

/**
 * The confident winner, or null. Releases of the same release group count as
 * the same answer (we match at group level), so only a different group as
 * runner-up blocks the margin test.
 */
export function pickConfident(
	ranked: ScoredRelease[],
	threshold = AUTO_MATCH_THRESHOLD,
	margin = AUTO_MATCH_MARGIN,
): ScoredRelease | null {
	const top = ranked[0];
	if (!top || top.score < threshold) return null;
	const topRg = top.hit['release-group']?.id;
	const rival = ranked.find((r) => r !== top && (!topRg || r.hit['release-group']?.id !== topRg));
	if (rival && top.score - rival.score < margin) return null;
	return top;
}

export function toCandidate(s: ScoredRelease): MusicMatchCandidate {
	const rg = s.hit['release-group'];
	return {
		releaseMbid: s.hit.id,
		releaseGroupMbid: rg?.id ?? null,
		title: s.hit.title,
		artistCredit: creditName(s.hit['artist-credit']),
		year: yearOf(s.hit.date),
		trackCount: s.hit['track-count'] ?? null,
		country: s.hit.country ?? null,
		format: s.hit.media?.[0]?.format ?? null,
		status: s.hit.status ?? null,
		primaryType: rg?.['primary-type'] ?? null,
		secondaryTypes: rg?.['secondary-types'] ?? [],
		score: s.score,
	};
}

/** Candidate list for manual choice: best release per release group, top 10. */
export function candidateList(ranked: ScoredRelease[]): MusicMatchCandidate[] {
	const seen = new Set<string>();
	const out: MusicMatchCandidate[] = [];
	for (const r of ranked) {
		if (r.score < MIN_CANDIDATE_SCORE) break;
		const key = r.hit['release-group']?.id ?? r.hit.id;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(toCandidate(r));
		if (out.length >= 10) break;
	}
	return out;
}

/** Map MB primary/secondary types to our albums.primary_type vocabulary. */
export function mapAlbumType(primary: string | undefined, secondary: string[] = []): string {
	const sec = secondary.map((s) => s.toLowerCase());
	if (sec.includes('compilation')) return 'compilation';
	if (sec.includes('soundtrack')) return 'soundtrack';
	if (sec.includes('live')) return 'live';
	const p = (primary ?? '').toLowerCase();
	if (p === 'album' || p === 'ep' || p === 'single') return p;
	return p ? 'other' : 'album';
}

/** Lucene query for the release search. */
export function buildReleaseQuery(local: Pick<LocalAlbum, 'title' | 'artist' | 'various'>): string {
	const parts = [`release:"${escapeLucene(local.title)}"`];
	if (local.artist && !local.various) parts.push(`artist:"${escapeLucene(local.artist)}"`);
	return parts.join(' AND ');
}

function round(n: number): number {
	return Math.round(n * 1000) / 1000;
}

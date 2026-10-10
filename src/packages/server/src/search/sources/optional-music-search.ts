import type { MusicSearchHit } from '@mu/shared';
import { fetchWithTimeout } from '../../common/http/polite-fetch.js';
import { scoreMusic } from '../dedup.js';

/**
 * Optional credentialed music search sources. Both are skipped silently
 * (`enabled()` false) unless a credential row exists in the provider platform
 * (`provider_credentials`): Last.fm → `lastfm.apiKey`, Discogs → `discogs.token`.
 */

const LASTFM = 'https://ws.audioscrobbler.com/2.0/';
const TIMEOUT_MS = 4500;

const pickImage = (images?: Array<{ '#text'?: string; size?: string }>): string | undefined => {
	const url = images?.find((i) => i.size === 'large')?.['#text'] ?? images?.at(-1)?.['#text'];
	// Last.fm's placeholder star image is useless — drop it.
	return url && !url.includes('2a96cbd8b46e442fc41c2b86b821562f') ? url : undefined;
};

async function lastfmGet<T>(apiKey: string, params: Record<string, string>): Promise<T> {
	const qs = new URLSearchParams({ ...params, api_key: apiKey, format: 'json', limit: '6' });
	const res = await fetchWithTimeout(`${LASTFM}?${qs}`, { timeoutMs: TIMEOUT_MS });
	if (!res.ok) throw new Error(`Last.fm ${res.status}`);
	return (await res.json()) as T;
}

const mbidOrUndef = (s?: string) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : undefined);

export async function lastfmSearch(apiKey: string, query: string): Promise<MusicSearchHit[]> {
	const [artists, albums, tracks] = await Promise.all([
		lastfmGet<any>(apiKey, { method: 'artist.search', artist: query }).catch(() => null),
		lastfmGet<any>(apiKey, { method: 'album.search', album: query }).catch(() => null),
		lastfmGet<any>(apiKey, { method: 'track.search', track: query }).catch(() => null),
	]);
	if (!artists && !albums && !tracks) throw new Error('Last.fm unavailable');
	const out: MusicSearchHit[] = [];
	for (const a of artists?.results?.artistmatches?.artist ?? []) {
		out.push({
			kind: 'artist',
			mbid: mbidOrUndef(a.mbid),
			title: String(a.name ?? ''),
			sources: ['lastfm'],
			isOwned: false,
			matchScore: 0,
		});
	}
	for (const a of albums?.results?.albummatches?.album ?? []) {
		out.push({
			kind: 'album',
			title: String(a.name ?? ''),
			artist: a.artist ? String(a.artist) : undefined,
			artUrl: pickImage(a.image),
			sources: ['lastfm'],
			isOwned: false,
			matchScore: 0,
		});
	}
	for (const t of tracks?.results?.trackmatches?.track ?? []) {
		out.push({
			kind: 'track',
			mbid: mbidOrUndef(t.mbid),
			title: String(t.name ?? ''),
			artist: t.artist ? String(t.artist) : undefined,
			sources: ['lastfm'],
			isOwned: false,
			matchScore: 0,
		});
	}
	return out
		.filter((h) => h.title)
		.map((h) => ({ ...h, matchScore: scoreMusic(query, h) * 0.9 }));
}

export async function discogsSearch(token: string, query: string): Promise<MusicSearchHit[]> {
	const run = async (type: 'artist' | 'master') => {
		const qs = new URLSearchParams({ q: query, type, per_page: '6' });
		const res = await fetchWithTimeout(`https://api.discogs.com/database/search?${qs}`, {
			timeoutMs: TIMEOUT_MS,
			headers: { Authorization: `Discogs token=${token}` },
		});
		if (!res.ok) throw new Error(`Discogs ${res.status}`);
		return ((await res.json()) as { results?: any[] }).results ?? [];
	};
	const [artists, masters] = await Promise.all([run('artist'), run('master')]);
	const out: MusicSearchHit[] = [];
	for (const a of artists) {
		out.push({
			kind: 'artist',
			title: String(a.title ?? ''),
			artUrl: a.thumb || undefined,
			sources: ['discogs'],
			isOwned: false,
			matchScore: 0,
		});
	}
	for (const m of masters) {
		// Discogs titles are "Artist - Title".
		const [artist, ...rest] = String(m.title ?? '').split(' - ');
		const title = rest.join(' - ') || artist || '';
		const year = Number.parseInt(String(m.year ?? ''), 10);
		out.push({
			kind: 'album',
			title,
			artist: rest.length ? artist : undefined,
			year: Number.isFinite(year) ? year : undefined,
			artUrl: m.thumb || undefined,
			sources: ['discogs'],
			isOwned: false,
			matchScore: 0,
		});
	}
	return out
		.filter((h) => h.title)
		.map((h) => ({ ...h, matchScore: scoreMusic(query, h) * 0.85 }));
}

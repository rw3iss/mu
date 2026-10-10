import type {
	MovieSearchHit,
	MusicSearchHit,
	PersonSearchHit,
	SearchSource,
} from './search-types.js';

export function normalizeQuery(q: string): string {
	return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

function slug(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function movieDedupKey(hit: MovieSearchHit): string {
	if (hit.imdbId) return `imdb:${hit.imdbId}`;
	if (hit.tmdbId) return `tmdb:${hit.tmdbId}`;
	if (hit.movieId) return `local:${hit.movieId}`;
	return `slug:${slug(hit.title)}|${hit.year ?? ''}`;
}

export function personDedupKey(hit: PersonSearchHit): string {
	if (hit.tmdbId) return `tmdb:${hit.tmdbId}`;
	if (hit.traktId) return `trakt:${hit.traktId}`;
	return `key:${hit.personKey}`;
}

function mergeSources(a: SearchSource[], b: SearchSource[]): SearchSource[] {
	const out = [...a];
	for (const s of b) if (!out.includes(s)) out.push(s);
	return out;
}

function preferFilled<T>(a: T | undefined, b: T | undefined): T | undefined {
	return a ?? b;
}

export function mergeMovieHit(a: MovieSearchHit, b: MovieSearchHit): MovieSearchHit {
	return {
		movieId: preferFilled(a.movieId, b.movieId),
		imdbId: preferFilled(a.imdbId, b.imdbId),
		tmdbId: preferFilled(a.tmdbId, b.tmdbId),
		traktId: preferFilled(a.traktId, b.traktId),
		title: a.title || b.title,
		year: preferFilled(a.year, b.year),
		posterUrl: preferFilled(a.posterUrl, b.posterUrl),
		overview: preferFilled(a.overview, b.overview),
		tmdbRating: preferFilled(a.tmdbRating, b.tmdbRating),
		tmdbVotes: preferFilled(a.tmdbVotes, b.tmdbVotes),
		imdbRating: preferFilled(a.imdbRating, b.imdbRating),
		imdbVotes: preferFilled(a.imdbVotes, b.imdbVotes),
		sources: mergeSources(a.sources, b.sources),
		isOwned: a.isOwned || b.isOwned,
		matchScore: Math.max(a.matchScore, b.matchScore),
	};
}

export function mergePersonHit(a: PersonSearchHit, b: PersonSearchHit): PersonSearchHit {
	return {
		personKey: a.personKey || b.personKey,
		tmdbId: preferFilled(a.tmdbId, b.tmdbId),
		traktId: preferFilled(a.traktId, b.traktId),
		name: a.name || b.name,
		profileUrl: preferFilled(a.profileUrl, b.profileUrl),
		role: preferFilled(a.role, b.role),
		knownFor: a.knownFor && a.knownFor.length ? a.knownFor : b.knownFor,
		sources: mergeSources(a.sources, b.sources),
		isOwned: a.isOwned || b.isOwned,
		matchScore: Math.max(a.matchScore, b.matchScore),
	};
}

export function scoreMovie(query: string, hit: MovieSearchHit): number {
	const q = normalizeQuery(query);
	const t = normalizeQuery(hit.title);
	if (t === q) return 1.0;
	if (t.startsWith(q)) return 0.85;
	if (t.includes(q)) return 0.6;
	return 0.4;
}

// ── Music ────────────────────────────────────────────────────────────────

/** Loose normaliser for music titles/names: case, accents, punctuation, leading "the". */
export function normMusic(s: string | undefined | null): string {
	return slug(s ?? '')
		.replace(/-/g, ' ')
		.replace(/^the /, '')
		.trim();
}

/**
 * Dedup keys for a music hit, strongest first: MBID, local id, then normalised
 * (artist, title, year) — tracks drop the year (rarely known per recording),
 * artists use the name alone.
 */
export function musicDedupKeys(hit: MusicSearchHit): string[] {
	const keys: string[] = [];
	if (hit.mbid) keys.push(`${hit.kind}:mb:${hit.mbid}`);
	if (hit.localId) keys.push(`${hit.kind}:local:${hit.localId}`);
	const title = normMusic(hit.title);
	if (!title) return keys;
	if (hit.kind === 'artist') keys.push(`artist:n:${title}`);
	else if (hit.kind === 'album')
		keys.push(`album:n:${normMusic(hit.artist)}|${title}|${hit.year ?? ''}`);
	else keys.push(`track:n:${normMusic(hit.artist)}|${title}`);
	return keys;
}

/** Merge two hits for the same entity. Owned (local) fields win; sources union. */
export function mergeMusicHit(a: MusicSearchHit, b: MusicSearchHit): MusicSearchHit {
	const [first, second] = b.isOwned && !a.isOwned ? [b, a] : [a, b];
	return {
		kind: first.kind,
		localId: preferFilled(first.localId, second.localId),
		mbid: preferFilled(first.mbid, second.mbid),
		title: first.title || second.title,
		artist: preferFilled(first.artist, second.artist),
		album: preferFilled(first.album, second.album),
		albumId: preferFilled(first.albumId, second.albumId),
		albumMbid: preferFilled(first.albumMbid, second.albumMbid),
		year: preferFilled(first.year, second.year),
		artUrl: preferFilled(first.artUrl, second.artUrl),
		primaryType: preferFilled(first.primaryType, second.primaryType),
		durationSeconds: preferFilled(first.durationSeconds, second.durationSeconds),
		detail: preferFilled(first.detail, second.detail),
		sources: mergeSources(a.sources, b.sources),
		isOwned: a.isOwned || b.isOwned,
		matchScore: Math.max(a.matchScore, b.matchScore),
	};
}

export function scoreMusic(query: string, hit: MusicSearchHit): number {
	const q = normMusic(query);
	const t = normMusic(hit.title);
	const full = hit.artist ? `${normMusic(hit.artist)} ${t}` : t;
	if (t === q || full === q) return 1.0;
	if (t.startsWith(q) || full.startsWith(q)) return 0.85;
	if (t.includes(q) || full.includes(q)) return 0.6;
	return 0.4;
}

export function scorePerson(query: string, hit: PersonSearchHit): number {
	const q = normalizeQuery(query);
	const n = normalizeQuery(hit.name);
	if (n === q) return 1.0;
	if (n.startsWith(q)) return 0.85;
	if (n.includes(q)) return 0.6;
	return 0.4;
}

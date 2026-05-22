import type {
	MovieSearchHit,
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

export function scorePerson(query: string, hit: PersonSearchHit): number {
	const q = normalizeQuery(query);
	const n = normalizeQuery(hit.name);
	if (n === q) return 1.0;
	if (n.startsWith(q)) return 0.85;
	if (n.includes(q)) return 0.6;
	return 0.4;
}

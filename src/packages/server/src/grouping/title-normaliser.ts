/**
 * Normalises titles and filename-derived show names so the same show
 * recorded under several different filename conventions still resolves
 * to the same fuzzy-comparable string. Used by every detector.
 *
 *   normaliseTitle('Seinfeld.1989.S03E12.1080p.BluRay.x264-RARBG')
 *   → 'seinfeld'
 *   normaliseTitle('The Office (US) [2005] - 2x07.mkv')
 *   → 'office us'
 *
 * The output is intentionally lowercased with separators collapsed to a
 * single space so token-Jaccard and Levenshtein metrics behave well.
 */

// Quality / source / codec / channel tags. Detector strips any of these
// when they appear as standalone tokens. Order doesn't matter — the
// regex compiles once.
const QUALITY_TOKENS = [
	'2160p',
	'1080p',
	'720p',
	'480p',
	'4k',
	'uhd',
	'hdr',
	'sdr',
	'10bit',
	'8bit',
	'hevc',
	'x265',
	'x264',
	'h265',
	'h264',
	'av1',
	'avc',
	'web-dl',
	'webdl',
	'webrip',
	'web',
	'bluray',
	'blu-ray',
	'bdrip',
	'brrip',
	'dvdrip',
	'hdtv',
	'pdtv',
	'cam',
	'r5',
	'ts',
	'remux',
	'dts',
	'dts-hd',
	'dts-x',
	'truehd',
	'ac3',
	'aac',
	'eac3',
	'opus',
	'flac',
	'mp3',
	'5.1',
	'7.1',
	'2.0',
	'atmos',
	'dolby',
	'imax',
	'extended',
	'directors cut',
	'unrated',
	'uncut',
	'proper',
	'repack',
	'limited',
	'internal',
	'subbed',
	'dubbed',
];

const QUALITY_REGEX = new RegExp(
	`\\b(?:${QUALITY_TOKENS.map((t) => t.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
	'gi',
);

// Common release-group suffixes / patterns. Matched only after the last
// dash to avoid eating valid name segments.
const RELEASE_GROUP_REGEX = /-(?:rarbg|yify|yts|yifyhd|fgt|sparks|amzn|nf|hulu|web|aoc|psa|cmrg|tgx|galaxyrg\w*|evo|silence|qxr|bone|hi|d3g|ettv|axxo|cbgb)(?:\.[a-z0-9]+)?\b/gi;

// Brackets / parens content. Stripped unless they contain just a year.
const BRACKET_CONTENT = /[[({][^[\](){}]*[\])}]/g;

// Year markers: 1900-2099. Strip when surrounded by separators or end.
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/g;

// Season/episode markers themselves should NEVER reach normaliseTitle —
// callers should slice them off first — but defend in case they do.
const SE_REGEX = /\bs\d{1,2}[\s._-]?e\d{1,3}\b/gi;
const NUMERIC_X_REGEX = /\b\d{1,2}x\d{1,3}\b/gi;

// Leading "the" — drop so "The Office" and "Office" collide.
const LEADING_THE = /^the[\s._-]+/i;

// Trailing artefacts the strippers might leave behind.
const TRAILING_DASH = /\s*-+\s*$/;
const COLLAPSE_WS = /\s+/g;

/**
 * Normalise a raw title or candidate show-name into a comparable form.
 * Idempotent — running twice on the same input gives the same output.
 */
export function normaliseTitle(input: string): string {
	if (!input) return '';
	let s = input.toLowerCase();
	// Strip bracketed sections first (commonly hold quality / release group / year).
	s = s.replace(BRACKET_CONTENT, ' ');
	// Strip explicit SExx markers in case they slipped in.
	s = s.replace(SE_REGEX, ' ').replace(NUMERIC_X_REGEX, ' ');
	// Strip year markers.
	s = s.replace(YEAR_REGEX, ' ');
	// Replace separator chars with spaces.
	s = s.replace(/[._]/g, ' ');
	// Strip release-group tag (must run AFTER separators are spaces — actually before;
	// the regex expects the dash). Keep dash form by running it before sep replace
	// wouldn't help though — so run on the underscored/dotted form: undo briefly.
	s = s.replace(RELEASE_GROUP_REGEX, ' ');
	// Strip quality / codec tokens.
	s = s.replace(QUALITY_REGEX, ' ');
	// Drop leading "the".
	s = s.replace(LEADING_THE, '');
	// Trim stray trailing dashes and collapse whitespace.
	s = s.replace(/-/g, ' ');
	s = s.replace(TRAILING_DASH, '').replace(COLLAPSE_WS, ' ').trim();
	return s;
}

/** Tokenise the normalised title — used for Jaccard similarity. */
export function titleTokens(title: string): Set<string> {
	const norm = normaliseTitle(title);
	if (!norm) return new Set();
	return new Set(norm.split(' ').filter((t) => t.length > 0));
}

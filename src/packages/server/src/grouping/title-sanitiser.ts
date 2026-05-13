/**
 * Title sanitisation primitives — the single source of truth for
 * "given a messy filename / DB title, what's the clean human-readable
 * title and (if it's a TV episode) what season + episode?"
 *
 * Used by:
 *   - Every grouping detector (sxxexx, folder-tree, multi-file, fuzzy)
 *   - The Admin "Sanitize Title Names" action that rewrites the
 *     stored title for movies without TMDB metadata.
 *
 * Two-phase approach so detectors can grab clean show prefixes even
 * when the file has both a season marker AND release-group noise:
 *
 *   1. `parseSeasonEpisode(input)` — locate the SxxExx / NxNN /
 *      "Episode N" marker. Returns `{ prefix, season, episode }` or
 *      null. The prefix is whatever came BEFORE the marker — typically
 *      the show name (still potentially dirty).
 *
 *   2. `sanitiseRawTitle(rawCandidate)` — strip year, brackets,
 *      quality / codec / channel / release-group tokens; collapse
 *      separators; drop leading "the". Returns a clean lowercase
 *      space-separated title.
 *
 * `buildPrettyTitle()` composes a display string:
 *   - movie:        "1917"
 *   - TV episode:   "Norsemen - S01E04"
 *   - TV w/o SE:    "Some Show"
 */

const QUALITY_TOKENS = [
	'2160p',
	'1080p',
	'720p',
	'480p',
	'360p',
	'4k',
	'uhd',
	'hdr',
	'hdr10',
	'hdr10+',
	'sdr',
	'10bit',
	'8bit',
	'12bit',
	'hevc',
	'x265',
	'x264',
	'h265',
	'h264',
	'h\\.264',
	'h\\.265',
	'av1',
	'avc',
	'vp9',
	'xvid',
	'divx',
	'web-dl',
	'webdl',
	'web\\.dl',
	'webrip',
	'web',
	'bluray',
	'blu-ray',
	'blu\\.ray',
	'bdrip',
	'bdrip',
	'brrip',
	'dvdrip',
	'dvd',
	'hdtv',
	'pdtv',
	'cam',
	'r5',
	'hdcam',
	'hdts',
	'ts',
	'telesync',
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
	'5\\.1',
	'7\\.1',
	'2\\.0',
	'5 1',
	'7 1',
	'2 0',
	'ddp5',
	'ddp7',
	'dd5',
	'dd7',
	'atmos',
	'dolby',
	'imax',
	'extended',
	'directors cut',
	'directors\\.cut',
	'unrated',
	'uncut',
	'proper',
	'repack',
	'limited',
	'internal',
	'subbed',
	'dubbed',
	'multi',
	'multi-sub',
	'multi-audio',
	'dual',
	'dual-audio',
	'rip',
	'screener',
];

const QUALITY_REGEX = new RegExp(
	`\\b(?:${QUALITY_TOKENS.join('|')})\\b`,
	'gi',
);

// Release-group: trailing `-NAME` (often after a quality token) or
// matching well-known groups anywhere.
const KNOWN_GROUPS = [
	'rarbg',
	'yify',
	'yts',
	'yifyhd',
	'fgt',
	'sparks',
	'amzn',
	'nf',
	'hulu',
	'aoc',
	'psa',
	'cmrg',
	'tgx',
	'galaxyrg\\w*',
	'evo',
	'silence',
	'qxr',
	'bone',
	'hi',
	'd3g',
	'ettv',
	'axxo',
	'cbgb',
	'ettv',
	'ettvdl',
	'eztv\\w*',
	'mircrew',
	'ettv\\w*',
	'neonoir',
	'ghosts',
	'ajp69',
	'edhd',
	'successfulcrab',
];
const KNOWN_GROUP_REGEX = new RegExp(
	`-\\s*(?:${KNOWN_GROUPS.join('|')})\\b(?:\\.[a-z0-9]+)?`,
	'gi',
);

// Trailing `-anything-uppercase` pattern (best-effort release group catch).
// Conservative: only matches when preceded by quality token (so we don't
// eat real names like "Spider-Man").
const TRAILING_GROUP_AFTER_QUALITY = /-([A-Za-z][\w]{2,})\s*$/;

// Bracketed sections: [...], (...), {...}. Stripped entirely.
const BRACKET_CONTENT = /[\[({][^\[\](){}]*[\])}]/g;

// Year markers 1900-2099.
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/g;

// Season/episode patterns. Order matters — most specific first.
const SE_PATTERNS: { regex: RegExp; season: number; episode: number }[] = [
	// S01E04, s01 e04, S01.E04, S01-E04
	{ regex: /(?:^|[\s._\-])s(\d{1,2})[\s._\-]?e(\d{1,3})(?=[\s._\-]|$|\.)/i, season: 1, episode: 2 },
	// 3x07, 03x07
	{ regex: /(?:^|[\s._\-])(\d{1,2})x(\d{1,3})(?=[\s._\-]|$|\.)/i, season: 1, episode: 2 },
	// Season 1 Episode 4
	{
		regex: /(?:^|[\s._\-])season[\s._\-]?(\d{1,2})[\s._\-]+episode[\s._\-]?(\d{1,3})/i,
		season: 1,
		episode: 2,
	},
];

// Standalone "Season N" / "S0N" marker (no episode) — for folder-tree only.
const SEASON_ONLY = /(?:^|[\s._\-])(?:season|series|s)[\s._\-]?(\d{1,3})(?=[\s._\-]|$|\.)/i;

const LEADING_THE = /^the[\s._\-]+/i;
const COLLAPSE_WS = /\s+/g;
const TRAILING_PUNCT = /[\s._\-]+$/;
const LEADING_PUNCT = /^[\s._\-]+/;

/**
 * Generic top-level folder names that must NEVER become a grouping
 * parent. If a detector ends up here, it's misfiring on the user's
 * library root and would group every loose movie together.
 */
export const GENERIC_FOLDER_NAMES = new Set([
	'movies',
	'movie',
	'tv',
	'tvshows',
	'tv shows',
	'tv-shows',
	'shows',
	'series',
	'videos',
	'video',
	'media',
	'downloads',
	'films',
	'film',
	'mu',
	'plex',
	'jellyfin',
	'emby',
	'kodi',
	'unsorted',
	'misc',
	'new',
	'temp',
	'tmp',
	'sample',
	'samples',
]);

export interface SeasonEpisodeMatch {
	/** Text that came before the SE marker — show name candidate. */
	prefix: string;
	season: number;
	episode: number;
	/** The index where the SE marker started in the original string. */
	startIndex: number;
	/** The full match text, e.g. "S01E04". */
	matchText: string;
}

/**
 * Find a season/episode marker anywhere in the input. Returns null if
 * no marker found. Prefers stronger patterns (S01E04) over weaker
 * (3x07, Season 1 Episode 4).
 */
export function parseSeasonEpisode(input: string): SeasonEpisodeMatch | null {
	if (!input) return null;
	const stripped = stripExtension(input);
	for (const { regex, season, episode } of SE_PATTERNS) {
		const m = regex.exec(stripped);
		if (m) {
			return {
				prefix: stripped.slice(0, m.index),
				season: parseInt(m[season]!, 10),
				episode: parseInt(m[episode]!, 10),
				startIndex: m.index,
				matchText: m[0]!.trim(),
			};
		}
	}
	return null;
}

/**
 * Parse a standalone "Season N" / "S0N" marker (no episode). Used by
 * the folder-tree detector to recognise season folders.
 */
export function parseSeasonOnly(input: string): number | null {
	if (!input) return null;
	const m = SEASON_ONLY.exec(input);
	return m ? parseInt(m[1]!, 10) : null;
}

/**
 * Sanitise a raw title fragment — strip quality, release group, year,
 * brackets, separators. Returns a lowercase, space-collapsed string
 * ready for display title-casing or for token comparison.
 *
 * Idempotent: passing the output back in returns the same string.
 */
export function sanitiseRawTitle(input: string): string {
	if (!input) return '';
	let s = String(input);

	// Strip extension if it accidentally got in here.
	s = stripExtension(s);

	// First pass — bracketed sections + year.
	s = s.replace(BRACKET_CONTENT, ' ');
	s = s.replace(YEAR_REGEX, ' ');

	// Replace common separators with spaces BEFORE running token regexes
	// so tokens delimited by '.' or '_' get caught.
	s = s.replace(/[._]+/g, ' ');

	// Strip known release groups (handles "-NEONOIR", "-AJP69" etc).
	s = s.replace(KNOWN_GROUP_REGEX, ' ');

	// Strip quality / codec / channel tokens.
	s = s.replace(QUALITY_REGEX, ' ');

	// Trailing-group-after-quality second pass (catches groups our
	// known-list missed) — only safe after quality tokens are gone.
	s = s.replace(TRAILING_GROUP_AFTER_QUALITY, ' ');

	// Lowercase + drop "the" prefix.
	s = s.toLowerCase();
	s = s.replace(LEADING_THE, '');

	// Collapse dashes that became sandwiched between spaces.
	s = s.replace(/\s+-\s+/g, ' ');
	s = s.replace(/-+/g, ' ');

	// Final whitespace cleanup.
	s = s.replace(LEADING_PUNCT, '').replace(TRAILING_PUNCT, '');
	s = s.replace(COLLAPSE_WS, ' ').trim();

	return s;
}

/**
 * Tokens of a sanitised title — for Jaccard similarity.
 */
export function titleTokens(input: string): Set<string> {
	const s = sanitiseRawTitle(input);
	if (!s) return new Set();
	return new Set(s.split(' ').filter((t) => t.length > 0));
}

/**
 * Build a user-facing pretty title from a raw filename / messy title.
 * If a season/episode marker is found, formats as
 * `Show Name - S01E04`. Otherwise just the cleaned title (title-cased).
 *
 * Used by the Admin sanitize-titles action.
 */
export function buildPrettyTitle(rawInput: string): string {
	if (!rawInput) return rawInput;
	const stripped = stripExtension(rawInput);
	const se = parseSeasonEpisode(stripped);
	const boundary = findTitleBoundary(stripped);
	const titleSource = boundary > 0 ? stripped.slice(0, boundary) : stripped;

	const clean = sanitiseRawTitle(titleSource);
	if (!clean) return rawInput;
	const pretty = titleCase(clean);
	if (se) return `${pretty} - S${pad2(se.season)}E${pad2(se.episode)}`;
	return pretty;
}

/**
 * Find the earliest "title boundary" in a filename — the position past
 * which everything is metadata. Boundaries: SxxExx marker, year
 * (1900-2099), or quality token (1080p, BluRay, x264, etc.). Caller
 * slices [0, boundary) to get the title prefix.
 */
function findTitleBoundary(input: string): number {
	let earliest = input.length;
	const yearMatch = /\b(?:19\d{2}|20\d{2})\b/.exec(input);
	if (yearMatch && yearMatch.index > 0 && yearMatch.index < earliest) {
		earliest = yearMatch.index;
	}
	const se = parseSeasonEpisode(input);
	if (se && se.startIndex > 0 && se.startIndex < earliest) {
		earliest = se.startIndex;
	}
	const quality = new RegExp(QUALITY_REGEX.source, 'i').exec(input);
	if (quality && quality.index > 0 && quality.index < earliest) {
		earliest = quality.index;
	}
	return earliest;
}

/**
 * Determine whether the existing title looks "dirty" — i.e. still has
 * release artefacts and would benefit from sanitisation. Used by the
 * admin action to decide whether to overwrite a given title.
 */
export function isDirtyTitle(input: string): boolean {
	if (!input) return false;
	const lower = input.toLowerCase();
	// Has quality / codec / release-group / SE marker / square brackets / underscores / dots between words.
	if (QUALITY_REGEX.test(lower)) return true;
	QUALITY_REGEX.lastIndex = 0;
	if (KNOWN_GROUP_REGEX.test(lower)) return true;
	KNOWN_GROUP_REGEX.lastIndex = 0;
	if (parseSeasonEpisode(input)) return true; // dirty enough to want SxxExx-isation
	if (/\[|\]|\{|\}/.test(input)) return true;
	if (/\w\.\w/.test(input)) return true;
	return false;
}

function stripExtension(input: string): string {
	return input.replace(/\.[a-z0-9]{1,4}$/i, '');
}

function pad2(n: number): string {
	return n.toString().padStart(2, '0');
}

function titleCase(input: string): string {
	if (!input) return '';
	return input.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

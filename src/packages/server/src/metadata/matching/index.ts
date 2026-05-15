export {
	DEFAULT_MATCHER_CONFIG,
	findBestMatch,
	type MatchCandidate,
	type MatchQuery,
	type MatchResult,
	type MatcherConfig,
	type ScoredCandidate,
} from './matcher.js';
export { buildTitleQuery, type TitleQuery } from './query-preprocessor.js';
export { resolveMatch, type ResolveOutcome } from './resolve.js';
export { normalizeTitle, titleSimilarity } from './title-normalizer.js';
export { extractYear, extractYearFromString } from './year-extractor.js';

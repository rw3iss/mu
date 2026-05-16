export {
	DEFAULT_MATCHER_CONFIG,
	findBestMatch,
	type MatchCandidate,
	type MatcherConfig,
	type MatchQuery,
	type MatchResult,
	type ScoredCandidate,
} from './matcher.js';
export { buildTitleQuery, type TitleQuery } from './query-preprocessor.js';
export { type ResolveOutcome, resolveMatch } from './resolve.js';
export { normalizeTitle, titleSimilarity } from './title-normalizer.js';
export { extractYear, extractYearFromString } from './year-extractor.js';

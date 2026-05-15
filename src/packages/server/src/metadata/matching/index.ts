export {
	DEFAULT_MATCHER_CONFIG,
	findBestMatch,
	type MatchCandidate,
	type MatchQuery,
	type MatchResult,
	type MatcherConfig,
	type ScoredCandidate,
} from './matcher.js';
export { normalizeTitle, titleSimilarity } from './title-normalizer.js';
export { extractYear, extractYearFromString } from './year-extractor.js';

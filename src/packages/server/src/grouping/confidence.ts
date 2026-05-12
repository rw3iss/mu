import { titleTokens } from './title-normaliser.js';

/**
 * Levenshtein distance — classic O(n·m) dynamic programming. Reasonable
 * for the short strings (typically <80 chars) we feed it. Returns the
 * minimum number of single-character edits between the two strings.
 */
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const m = a.length;
	const n = b.length;
	let prev = new Array(n + 1);
	let curr = new Array(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[n];
}

/** Symmetric set Jaccard: |A ∩ B| / |A ∪ B|, range 0..1. */
function jaccard(a: Set<string>, b: Set<string>): number {
	if (!a.size && !b.size) return 1;
	let intersect = 0;
	for (const t of a) if (b.has(t)) intersect++;
	const unionSize = a.size + b.size - intersect;
	return unionSize === 0 ? 0 : intersect / unionSize;
}

/**
 * Title similarity in 0..1. Blended Levenshtein (catches typos / case
 * variance) and token-Jaccard (catches reordering and missing/extra
 * qualifiers). Both inputs are normalised first so callers don't have
 * to worry about it.
 */
export function titleSimilarity(a: string, b: string): number {
	const ta = titleTokens(a);
	const tb = titleTokens(b);
	const ja = jaccard(ta, tb);

	const sa = [...ta].sort().join(' ');
	const sb = [...tb].sort().join(' ');
	const maxLen = Math.max(sa.length, sb.length);
	const lev = maxLen === 0 ? 1 : 1 - levenshtein(sa, sb) / maxLen;

	return 0.5 * lev + 0.5 * ja;
}

// ── Thresholds ──────────────────────────────────────────────────────
// These live as constants here so the rest of the code can reference
// them by symbolic name. They are exposed as runtime-overridable
// settings (see GroupingService); detectors read live values from the
// service rather than hardcoding the constants.

export interface GroupingThresholds {
	/** Above this, decision is applied as `confirmed`-eligible auto. */
	autoConfirmMin: number;
	/** Below this, no grouping happens. */
	unsureMin: number;
	/** Required similarity to attach to an existing parent group. */
	fuzzyMatchThreshold: number;
}

export const DEFAULT_THRESHOLDS: GroupingThresholds = {
	autoConfirmMin: 0.85,
	unsureMin: 0.55,
	fuzzyMatchThreshold: 0.78,
};

/** Bucket a confidence score into status. */
export function statusForConfidence(
	conf: number,
	thresholds: GroupingThresholds = DEFAULT_THRESHOLDS,
): 'auto' | 'unsure' | 'none' {
	if (conf >= thresholds.autoConfirmMin) return 'auto';
	if (conf >= thresholds.unsureMin) return 'unsure';
	return 'none';
}

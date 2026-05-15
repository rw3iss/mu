/**
 * Title normalization for fuzzy matching against external metadata
 * providers. Reuses the same sanitiser the grouping detectors use so a
 * filename like `Spider-Man.Into.The.Spider-Verse.2018.1080p.BluRay.x264-FOO.mkv`
 * becomes `spider man into spider verse` — comparable against TMDB's
 * `Spider-Man: Into the Spider-Verse` after the same pass.
 */

import { sanitiseRawTitle } from '../../grouping/title-sanitiser.js';

const ROMAN_NUMERAL_MAP: Record<string, string> = {
	i: '1',
	ii: '2',
	iii: '3',
	iv: '4',
	v: '5',
	vi: '6',
	vii: '7',
	viii: '8',
	ix: '9',
	x: '10',
};

/**
 * Normalize a title for comparison:
 *  - strips quality / codec / release-group tokens via shared sanitiser
 *  - lowercases, strips brackets, year markers
 *  - converts roman numerals (II → 2) so "Godfather Part II" matches "Godfather Part 2"
 *  - drops single-character noise tokens
 */
export function normalizeTitle(input: string): string {
	if (!input) return '';
	let s = sanitiseRawTitle(input);
	// sanitiseRawTitle already lowercases + collapses; still need roman → arabic.
	s = s
		.split(' ')
		.map((t) => ROMAN_NUMERAL_MAP[t] ?? t)
		.filter((t) => t.length > 1 || /\d/.test(t)) // keep numbers, drop stray single letters
		.join(' ');
	return s;
}

/** Build character bigrams from a normalized string, for Dice's coefficient. */
function bigrams(s: string): Map<string, number> {
	const map = new Map<string, number>();
	const compact = s.replace(/\s+/g, '');
	for (let i = 0; i < compact.length - 1; i++) {
		const bg = compact.slice(i, i + 2);
		map.set(bg, (map.get(bg) ?? 0) + 1);
	}
	return map;
}

/**
 * Sørensen–Dice coefficient on character bigrams. 0 = totally
 * different, 1 = identical. Robust against the "same words, different
 * order" case (e.g. "Bond, James" vs "James Bond") and handles
 * punctuation drops cleanly.
 */
export function titleSimilarity(a: string, b: string): number {
	const na = normalizeTitle(a);
	const nb = normalizeTitle(b);
	if (!na || !nb) return 0;
	if (na === nb) return 1;

	// Tiny strings — fall back to direct comparison so 2-letter titles
	// don't bias toward 0.
	if (na.length < 3 || nb.length < 3) {
		return na === nb ? 1 : 0;
	}

	const aGrams = bigrams(na);
	const bGrams = bigrams(nb);
	let intersection = 0;
	let aTotal = 0;
	let bTotal = 0;
	for (const v of aGrams.values()) aTotal += v;
	for (const v of bGrams.values()) bTotal += v;
	for (const [g, count] of aGrams) {
		const bc = bGrams.get(g);
		if (bc) intersection += Math.min(count, bc);
	}
	return (2 * intersection) / (aTotal + bTotal);
}

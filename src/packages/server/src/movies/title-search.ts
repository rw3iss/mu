import { type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { normalizeTitle } from '../common/text-normalize.js';

/**
 * Search-query parsing for title matching.
 *
 * Both sides are run through {@link normalizeTitle} first, so punctuation, case,
 * accents and the various Unicode apostrophes stop mattering: `Pans Labyrinth`
 * finds *Pan's Labyrinth*, and `Ocean’s Eleven` (curly), `Ocean's Eleven`
 * (straight) and `Oceans Eleven` are all the same query.
 *
 * On top of that, bare text stays LOOSE (substring) while anything in "double
 * quotes" must match as a WHOLE WORD — `"Her"` finds *Her* and *Death Becomes
 * Her* but not *Almost Heroes*. Mixing the two is an AND.
 */
export interface ParsedSearchQuery {
	/** Quoted terms, normalised — each must appear as a whole word. */
	phrases: string[];
	/** Everything outside the quotes, normalised; matched as a substring. */
	loose: string;
}

/** Split a raw query into quoted whole-word terms plus the leftover loose text. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
	const input = (raw ?? '').trim();
	if (!input) return { phrases: [], loose: '' };

	const phrases: string[] = [];
	// Grab "..." runs; an unterminated trailing quote is treated as loose text so
	// the search still works while the user is mid-typing. Only straight double
	// quotes delimit — the curly ones are far more likely to be part of a title.
	const rest = input.replace(/"([^"]*)"/g, (_m, inner: string) => {
		const term = normalizeTitle(inner);
		if (term) phrases.push(term);
		return ' ';
	});

	return { phrases, loose: normalizeTitle(rest.replace(/"/g, ' ')) };
}

/** Escape the LIKE wildcards so a literal `%` or `_` in a title can't glob. */
function escapeLike(term: string): string {
	return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Build the WHERE condition for a raw search query against a title column.
 * Returns null when the query normalises to nothing (caller adds no condition).
 *
 * Matching runs against `mu_norm(title)` — the same normaliser applied to the
 * query — so the comparison is punctuation- and accent-insensitive. Because
 * normalisation turns every separator into a single space, a whole-word test is
 * just a padded substring match on spaces.
 */
export function titleSearchCondition(column: AnySQLiteColumn, raw: string): SQL | null {
	const { phrases, loose } = parseSearchQuery(raw);
	const parts: SQL[] = [];

	for (const p of phrases) {
		parts.push(
			sql`' ' || mu_norm(${column}) || ' ' LIKE ${`% ${escapeLike(p)} %`} ESCAPE '\\'`,
		);
	}
	if (loose) {
		parts.push(sql`mu_norm(${column}) LIKE ${`%${escapeLike(loose)}%`} ESCAPE '\\'`);
	}

	if (parts.length === 0) return null;
	return sql.join(parts, sql` AND `);
}

/**
 * In-memory equivalent of {@link titleSearchCondition}, for the paths that
 * filter already-loaded rows (e.g. group names) instead of querying SQL.
 * Keeping both here stops the two from drifting apart.
 */
export function matchesSearchQuery(text: string, raw: string): boolean {
	const { phrases, loose } = parseSearchQuery(raw);
	const haystack = normalizeTitle(text);
	const padded = ` ${haystack} `;
	for (const p of phrases) {
		if (!padded.includes(` ${p} `)) return false;
	}
	if (loose && !haystack.includes(loose)) return false;
	return true;
}

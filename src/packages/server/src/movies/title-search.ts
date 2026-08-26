import { type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Search-query parsing for title matching.
 *
 * Bare text stays LOOSE (substring, the long-standing behaviour). Anything in
 * "double quotes" becomes an EXACT WHOLE-WORD match, so `"Her"` finds *Her* and
 * *All About Her* but not *Hero* or *Hers*.
 *
 * Mixing both is an AND: `"Her" story` = titles containing the standalone word
 * "her" AND the substring "story".
 */
export interface ParsedSearchQuery {
	/** Quoted terms — each must appear as a whole word. */
	phrases: string[];
	/** Everything outside the quotes, collapsed; matched as a substring. */
	loose: string;
}

/** Split a raw query into quoted whole-word terms plus the leftover loose text. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
	const input = (raw ?? '').trim();
	if (!input) return { phrases: [], loose: '' };

	const phrases: string[] = [];
	// Grab "..." runs; an unterminated trailing quote is treated as loose text
	// so the search still works while the user is mid-typing.
	const rest = input.replace(/"([^"]*)"/g, (_m, inner: string) => {
		const term = inner.trim();
		if (term) phrases.push(term);
		return ' ';
	});

	return { phrases, loose: rest.replace(/"/g, ' ').replace(/\s+/g, ' ').trim() };
}

/**
 * Escape GLOB metacharacters by wrapping each in a character class — GLOB has
 * no ESCAPE clause, but `[*]` matches a literal `*`.
 */
function escapeGlob(term: string): string {
	return term.replace(/[[*?]/g, (ch) => `[${ch}]`);
}

/**
 * Whole-word match for `term` within `column`.
 *
 * Both sides are lowercased (GLOB is case-sensitive) and the column is padded
 * with spaces so a term at the very start or end still has a boundary on each
 * side. `[^a-z0-9]` as the boundary means punctuation counts as a separator, so
 * `"her"` matches "Her: Story" but not "Hero".
 */
function wholeWordCondition(column: AnySQLiteColumn, term: string): SQL {
	const pattern = `*[^a-z0-9]${escapeGlob(term.toLowerCase())}[^a-z0-9]*`;
	return sql`lower(' ' || ${column} || ' ') GLOB ${pattern}`;
}

/**
 * Build the WHERE condition for a raw search query against a title column.
 * Returns null when the query is empty (caller adds no condition).
 */
export function titleSearchCondition(column: AnySQLiteColumn, raw: string): SQL | null {
	const { phrases, loose } = parseSearchQuery(raw);
	const parts: SQL[] = phrases.map((p) => wholeWordCondition(column, p));
	if (loose) parts.push(sql`${column} LIKE ${`%${loose}%`}`);
	if (parts.length === 0) return null;
	return sql.join(parts, sql` AND `);
}

/**
 * In-memory equivalent of {@link titleSearchCondition}, for the paths that
 * filter already-loaded rows (e.g. group names) instead of querying SQL.
 * Keeping both in this module stops the two from drifting apart.
 */
export function matchesSearchQuery(text: string, raw: string): boolean {
	const { phrases, loose } = parseSearchQuery(raw);
	const haystack = (text ?? '').toLowerCase();
	for (const p of phrases) {
		const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(p.toLowerCase())}([^a-z0-9]|$)`);
		if (!re.test(haystack)) return false;
	}
	if (loose && !haystack.includes(loose.toLowerCase())) return false;
	return true;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

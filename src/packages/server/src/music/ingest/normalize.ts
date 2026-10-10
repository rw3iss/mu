import { normalizeTitle } from '../../common/text-normalize.js';

/** Lower-cased, accent-free, punctuation-free key for find-or-create matching. */
export function normKey(input: string | null | undefined): string {
	return normalizeTitle(input ?? '');
}

const LEADING_ARTICLES = /^(the|a|an|le|la|les|el|los|las|die|der|das)\s+/i;

/** Sort form: "The Beatles" → "Beatles, The". Keeps the original otherwise. */
export function sortName(name: string): string {
	const trimmed = name.trim();
	const m = trimmed.match(LEADING_ARTICLES);
	if (!m) return trimmed;
	return `${trimmed.slice(m[0].length)}, ${m[1]}`;
}

const FEAT = /\s+(?:feat\.?|ft\.?|featuring|with)\s+/i;

/**
 * Split an artist credit into primary + featured names.
 *
 * Only "feat./ft./featuring/with" split. "&", "and", "," and "/" are left alone:
 * "Simon & Garfunkel", "Earth, Wind & Fire" and "AC/DC" are single artists, and
 * guessing wrong fragments a real artist into bogus ones. Taggers that know
 * better write a multi-value ARTISTS tag, which callers prefer over this.
 */
export function splitCredit(credit: string): { primary: string[]; featured: string[] } {
	const clean = credit.replace(/\s*[([](?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]/i, ' feat. $1').trim();
	const [head, ...rest] = clean.split(FEAT);
	const primary = head ? [head.trim()].filter(Boolean) : [];
	const featured = rest.flatMap((r) => r.split(/\s*(?:,|&| and )\s*/i)).map((s) => s.trim()).filter(Boolean);
	return { primary, featured };
}

/** Strip "(Remastered 2011)"-style noise when comparing titles, not for display. */
export function titleKey(title: string): string {
	return normKey(
		title.replace(/\s*[([](?:\d{4}\s+)?(?:remaster(?:ed)?|deluxe|bonus track|explicit|clean)[^)\]]*[)\]]/gi, ''),
	);
}

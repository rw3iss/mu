/**
 * Title normalisation shared by the search SQL and the in-memory matchers.
 *
 * Folds away the things that stop a human-typed query from matching a stored
 * title: letter case, accents, the several Unicode apostrophes, fancy dashes
 * and quotes, and punctuation generally. Apostrophes are DELETED rather than
 * turned into a space so "Pan's" collapses to "pans" (matching a query typed
 * without the apostrophe); every other separator becomes a single space, so
 * word boundaries survive.
 *
 *   "Pan's Labyrinth"    -> "pans labyrinth"
 *   "Ocean's Eleven"     -> "oceans eleven"   (straight ' or curly ’)
 *   "Oceans Eleven"      -> "oceans eleven"
 *   "Amélie"             -> "amelie"
 *   "Spider-Man: No Way" -> "spider man no way"
 *
 * Registered with SQLite as `mu_norm()` (see DatabaseService) so the exact same
 * function normalises both sides of a comparison — the two can never drift.
 */

/** Every Unicode form of the apostrophe we're willing to treat as one. */
const APOSTROPHES = /['‘’‛ʼʻ′`´]/g;

export function normalizeTitle(input: string | null | undefined): string {
	if (!input) return '';
	return (
		input
			.toLowerCase()
			// Split accented characters into base + combining mark, then drop the
			// marks: "amélie" -> "amelie".
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			// Apostrophes vanish so "pan's" == "pans".
			.replace(APOSTROPHES, '')
			// Anything else that isn't a letter/digit becomes a separator. Uses the
			// Unicode property escapes so non-Latin titles keep their letters.
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim()
			.replace(/\s+/g, ' ')
	);
}

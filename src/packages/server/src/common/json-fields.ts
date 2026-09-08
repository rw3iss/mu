/**
 * JSON-as-text columns helpers.
 *
 * Several SQLite columns store JSON-encoded blobs (movie file
 * `subtitleTracks` / `audioTracks`, movie `playSettings`, metadata
 * `genres` / `directors` / `writers` / ..., job-history `payload`,
 * etc). Each consumer of those columns needs:
 *
 *   1. A safe parser that tolerates `null`, missing keys, malformed
 *      JSON without throwing — defaulting to a sensible empty value
 *      so downstream code can render uniformly.
 *   2. A serializer that returns `null` for empty inputs so we don't
 *      pollute the column with `"null"` / `"[]"` / `"{}"` literals.
 *
 * Centralising these prevents the repeated "serializer A returns []
 * but consumer B expects {}" drift that hid an entire bug last month
 * (job history payloads being shipped to the client as JSON strings
 * because the controller forgot the parse — fixed in commit f2cd92b).
 */

/**
 * Parse a JSON-encoded array column. Returns `[]` for null, missing,
 * malformed, or non-array values — never throws.
 */
export function parseJsonArray<T = unknown>(val: string | null | undefined): T[] {
	if (!val) return [];
	try {
		const parsed = JSON.parse(val);
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
}

/**
 * Parse a JSON-encoded object column. Returns `null` for null,
 * missing, malformed, or non-object values — never throws.
 */
export function parseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
	val: string | null | undefined,
): T | null {
	if (!val) return null;
	try {
		const parsed = JSON.parse(val);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as T;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Stringify an array for storage. Returns `null` for empty / null
 * inputs so the column stays NULL when there's nothing to store.
 */
export function stringifyJsonArray<T>(value: T[] | null | undefined): string | null {
	if (!value || value.length === 0) return null;
	return JSON.stringify(value);
}

/**
 * Stringify an object for storage. Returns `null` for empty objects
 * (no own keys) and null/undefined inputs.
 */
export function stringifyJsonObject(
	value: Record<string, unknown> | null | undefined,
): string | null {
	if (!value) return null;
	if (Object.keys(value).length === 0) return null;
	return JSON.stringify(value);
}

/**
 * Normalise a cast column into `CastMember` objects.
 *
 * Two shapes exist in the wild: TMDB contributes rich objects
 * (`{name, character, profileUrl, tmdbId}`), while OMDB's `Actors` field is a
 * comma string that the merge engine splits into BARE STRINGS. The client
 * reads `member.name`, so a string-shaped row rendered as blank chips with no
 * photo. Strings are promoted to `{ name }` here.
 *
 * Entries with no usable name are dropped outright — a nameless cast member
 * can't be displayed, linked to a person page, or de-duplicated, so it is
 * never worth storing or returning.
 */
export function normalizeCast<T = Record<string, unknown>>(raw: unknown): T[] {
	if (!Array.isArray(raw)) return [];
	const out: Array<Record<string, unknown>> = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		let member: Record<string, unknown> | null = null;
		if (typeof entry === 'string') {
			member = { name: entry };
		} else if (entry && typeof entry === 'object') {
			member = { ...(entry as Record<string, unknown>) };
		}
		if (!member) continue;

		const rawName = member.name;
		const name = typeof rawName === 'string' ? rawName.trim() : '';
		if (!name) continue;
		member.name = name;

		// Same person can arrive from two providers; keep the first (richer
		// TMDB entries are merged ahead of OMDB's bare names).
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(member);
	}
	return out as T[];
}

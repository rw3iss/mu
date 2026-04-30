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

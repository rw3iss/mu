/**
 * Canonical thumbnail-size union used by both server (sprite
 * generation) and client (Settings → Library, seek preview).
 *
 * Each size's actual pixel width lives in
 * `packages/server/src/media/sprite.service.ts::THUMBNAIL_SIZE_WIDTHS`
 * — kept server-side because that's where image generation happens.
 * The client only needs the union; widths are returned via the
 * sprite meta endpoint.
 *
 * Order is significant: SIZE_ORDER below mirrors smallest → largest
 * and drives the server's resolver fallback (prefer requested,
 * walk upward through SIZE_ORDER for stored larger caches, then
 * queue regen at the requested size).
 */
export type ThumbnailSize = 'small' | 'medium' | 'large' | 'xlarge';

/** Smallest → largest. Used by the server resolver. Exported so
 *  any future tooling (admin UI, tests) reads one canonical order. */
export const THUMBNAIL_SIZE_ORDER: readonly ThumbnailSize[] = [
	'small',
	'medium',
	'large',
	'xlarge',
] as const;

/** Default the client UI + server jobs both adopt when nothing
 *  is set. Chosen as 'large' so new users get sharp thumbnails;
 *  the server's resolver downgrades gracefully if only a smaller
 *  cache is available. */
export const DEFAULT_THUMBNAIL_SIZE: ThumbnailSize = 'large';

/** True if the input is one of the four canonical sizes.
 *  Use to validate untrusted input (URL query params, JSON payloads). */
export function isThumbnailSize(value: unknown): value is ThumbnailSize {
	return (
		value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge'
	);
}

/** Parse + fall back. Centralised so the server controller and
 *  client `useUiSetting` consumer agree on what "invalid" coerces to. */
export function parseThumbnailSize(
	value: unknown,
	fallback: ThumbnailSize = DEFAULT_THUMBNAIL_SIZE,
): ThumbnailSize {
	return isThumbnailSize(value) ? value : fallback;
}

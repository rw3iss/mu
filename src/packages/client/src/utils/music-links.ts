import type { MusicDiscoverItem, MusicSearchHit } from '@mu/shared';

/**
 * Where a music search / discovery result leads. Library entities go to their
 * page; MusicBrainz-only entities go to the `mb:` stub pages (like `tmdb:`
 * movie stubs). Tracks without a local page link to their album. Returns null
 * when there is nowhere to go (e.g. a Last.fm-only hit with no MBID).
 */
export function musicHitHref(
	hit: Pick<MusicSearchHit, 'kind' | 'localId' | 'mbid' | 'albumId' | 'albumMbid'>,
): string | null {
	if (hit.localId) return `/${hit.kind}/${hit.localId}`;
	if (hit.kind === 'track') {
		if (hit.albumId) return `/album/${hit.albumId}`;
		if (hit.albumMbid) return `/album/mb:${hit.albumMbid}`;
		return null;
	}
	return hit.mbid ? `/${hit.kind}/mb:${hit.mbid}` : null;
}

export function discoverItemHref(item: MusicDiscoverItem): string | null {
	return musicHitHref(item);
}

/** Stable client-side identity for a music hit (mirrors the server dedup order). */
export function musicHitKey(h: MusicSearchHit): string {
	if (h.mbid) return `${h.kind}:mb:${h.mbid}`;
	if (h.localId) return `${h.kind}:local:${h.localId}`;
	return `${h.kind}:n:${(h.artist ?? '').toLowerCase()}|${h.title.toLowerCase()}|${h.kind === 'album' ? (h.year ?? '') : ''}`;
}

export const MB_ID_PREFIX = 'mb:';
export const isMbId = (id: string | undefined): id is string => !!id?.startsWith(MB_ID_PREFIX);

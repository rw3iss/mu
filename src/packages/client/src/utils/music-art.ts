/**
 * Album / artist art URL at a given pixel size. Server art URLs look like
 * `/api/v1/music/art/<id>?size=600`; this swaps (or adds) the `size` param.
 */
export function artAtSize(url: string | null | undefined, size: number): string | null {
	if (!url) return null;
	if (/[?&]size=\d+/.test(url)) return url.replace(/([?&])size=\d+/, `$1size=${size}`);
	return `${url}${url.includes('?') ? '&' : '?'}size=${size}`;
}

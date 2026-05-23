/**
 * Page-level SEO + social-card metadata. One shape used by both the
 * server (which injects tags into index.html for crawlers / share
 * previews) and the client (which mutates `document.title` and
 * `<meta>` tags on SPA navigation).
 *
 * All fields are optional except `title` — resolvers may fill in
 * whatever they have and the renderer falls back to safe defaults.
 */
export interface SeoMeta {
	/** Page title — rendered as `<title>` and `og:title`. */
	title: string;
	/** ~160 char summary — rendered as `description` + `og:description`. */
	description?: string;
	/** Absolute URL to a card image (poster, profile photo, etc.). */
	image?: string;
	/**
	 * OpenGraph type. Defaults to `website`. Use `video.movie` for
	 * movie detail pages, `profile` for person pages, `video.other`
	 * for watch / share pages.
	 */
	type?: 'website' | 'video.movie' | 'video.other' | 'profile' | 'article';
	/** Absolute canonical URL for this page. */
	canonical?: string;
	/**
	 * Robots directive. Defaults to `noindex` for private installs
	 * (override per page to `index,follow` when public mode is on).
	 * Bots still render social cards even on `noindex` URLs.
	 */
	robots?: 'index,follow' | 'noindex,nofollow' | 'noindex,follow';
	/** Twitter card style. Defaults to `summary_large_image` when image is set. */
	twitterCard?: 'summary' | 'summary_large_image';
	/** Site name (top of OG cards). Defaults to "Mu". */
	siteName?: string;
}

/**
 * Server-only: a resolver returns this shape (or null to fall back
 * to defaults). Async because most resolvers look up DB rows.
 */
export type SeoResolver = (
	pathname: string,
	params: Record<string, string>,
) => Promise<SeoMeta | null>;

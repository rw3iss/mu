import type { SeoMeta } from '@mu/shared';

/**
 * Markers in index.html. Anything between them (including the
 * markers themselves) is replaced with the rendered tags. If the
 * markers are absent, the injector falls back to inserting tags
 * just before `</head>` so old HTML files still work.
 */
export const SEO_MARKER_START = '<!-- SEO_HEAD_START -->';
export const SEO_MARKER_END = '<!-- SEO_HEAD_END -->';

const DEFAULT_SITE_NAME = 'Mu';

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function clamp(s: string, n: number): string {
	const trimmed = s.replace(/\s+/g, ' ').trim();
	return trimmed.length > n ? `${trimmed.slice(0, n - 1)}…` : trimmed;
}

/**
 * Render SeoMeta into a block of `<title>` + `<meta>` tags suitable
 * for splicing into index.html.
 */
export function renderSeoHead(meta: SeoMeta): string {
	const siteName = meta.siteName ?? DEFAULT_SITE_NAME;
	const fullTitle = meta.title === siteName ? meta.title : `${meta.title} — ${siteName}`;
	const description = meta.description ? clamp(meta.description, 200) : undefined;
	const type = meta.type ?? 'website';
	const robots = meta.robots ?? 'noindex,nofollow';
	const twitterCard = meta.twitterCard ?? (meta.image ? 'summary_large_image' : 'summary');

	const lines: string[] = [SEO_MARKER_START];

	lines.push(`<title>${escapeHtml(fullTitle)}</title>`);
	if (description) {
		lines.push(`<meta name="description" content="${escapeHtml(description)}"/>`);
	}
	lines.push(`<meta name="robots" content="${escapeHtml(robots)}"/>`);

	// OpenGraph
	lines.push(`<meta property="og:site_name" content="${escapeHtml(siteName)}"/>`);
	lines.push(`<meta property="og:title" content="${escapeHtml(fullTitle)}"/>`);
	lines.push(`<meta property="og:type" content="${escapeHtml(type)}"/>`);
	if (description) {
		lines.push(`<meta property="og:description" content="${escapeHtml(description)}"/>`);
	}
	if (meta.image) {
		lines.push(`<meta property="og:image" content="${escapeHtml(meta.image)}"/>`);
	}
	if (meta.canonical) {
		lines.push(`<meta property="og:url" content="${escapeHtml(meta.canonical)}"/>`);
		lines.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}"/>`);
	}

	// Twitter
	lines.push(`<meta name="twitter:card" content="${escapeHtml(twitterCard)}"/>`);
	lines.push(`<meta name="twitter:title" content="${escapeHtml(fullTitle)}"/>`);
	if (description) {
		lines.push(`<meta name="twitter:description" content="${escapeHtml(description)}"/>`);
	}
	if (meta.image) {
		lines.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}"/>`);
	}

	lines.push(SEO_MARKER_END);
	return lines.join('\n\t');
}

/**
 * Splice rendered head tags into an HTML document. Replaces the
 * SEO_MARKER block when present; otherwise injects just before
 * `</head>`.
 */
export function injectSeoHead(html: string, head: string): string {
	const startIdx = html.indexOf(SEO_MARKER_START);
	const endIdx = html.indexOf(SEO_MARKER_END);
	if (startIdx >= 0 && endIdx > startIdx) {
		return html.slice(0, startIdx) + head + html.slice(endIdx + SEO_MARKER_END.length);
	}
	const headCloseIdx = html.indexOf('</head>');
	if (headCloseIdx >= 0) {
		return html.slice(0, headCloseIdx) + head + '\n' + html.slice(headCloseIdx);
	}
	return html;
}

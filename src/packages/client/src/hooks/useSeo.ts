import type { SeoMeta } from '@mu/shared';
import { useEffect } from 'preact/hooks';

const SITE_NAME = 'Mu';
const MANAGED_ATTR = 'data-mu-seo';

function setOrCreate(selector: string, attrs: Record<string, string>): void {
	let el = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
	if (!el) {
		const tag = selector.startsWith('link') ? 'link' : 'meta';
		el = document.createElement(tag) as HTMLMetaElement | HTMLLinkElement;
		el.setAttribute(MANAGED_ATTR, '1');
		document.head.appendChild(el);
	}
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k, v);
	}
}

function removeManaged(): void {
	const nodes = document.head.querySelectorAll(`[${MANAGED_ATTR}]`);
	nodes.forEach((n) => n.remove());
}

function clamp(s: string, n: number): string {
	const trimmed = s.replace(/\s+/g, ' ').trim();
	return trimmed.length > n ? `${trimmed.slice(0, n - 1)}…` : trimmed;
}

/**
 * Apply SEO meta to the document head. Updates `document.title`,
 * `<meta name="description">`, OG/Twitter tags, and the canonical
 * link. Tags it manages carry a `data-mu-seo` attribute so they
 * can be cleaned up before the next page applies its own.
 *
 * The server already injects equivalent tags into the initial
 * HTML response (for crawlers + share previews). This hook keeps
 * the in-app browsing experience — tab title, history entries —
 * accurate after client-side navigation.
 *
 * Usage:
 *   useSeo({ title: 'Discover', description: 'Find your next movie' });
 *   useSeo({ title: movie.title, image: movie.posterUrl, type: 'video.movie' });
 *
 * Pass `undefined` while data is loading; the hook no-ops until
 * you pass a real meta object.
 */
export function useSeo(meta: SeoMeta | null | undefined): void {
	useEffect(() => {
		if (!meta) return;

		const siteName = meta.siteName ?? SITE_NAME;
		const fullTitle =
			meta.title === siteName ? meta.title : `${meta.title} — ${siteName}`;
		const description = meta.description ? clamp(meta.description, 200) : undefined;
		const type = meta.type ?? 'website';
		const robots = meta.robots ?? 'noindex,nofollow';
		const twitterCard =
			meta.twitterCard ?? (meta.image ? 'summary_large_image' : 'summary');
		const canonical = meta.canonical ?? window.location.href.split('?')[0];

		document.title = fullTitle;
		removeManaged();

		setOrCreate('meta[name="description"]', {
			name: 'description',
			content: description ?? '',
		});
		setOrCreate('meta[name="robots"]', { name: 'robots', content: robots });

		setOrCreate('meta[property="og:site_name"]', {
			property: 'og:site_name',
			content: siteName,
		});
		setOrCreate('meta[property="og:title"]', {
			property: 'og:title',
			content: fullTitle,
		});
		setOrCreate('meta[property="og:type"]', { property: 'og:type', content: type });
		if (description) {
			setOrCreate('meta[property="og:description"]', {
				property: 'og:description',
				content: description,
			});
		}
		if (meta.image) {
			setOrCreate('meta[property="og:image"]', {
				property: 'og:image',
				content: meta.image,
			});
		}
		setOrCreate('meta[property="og:url"]', { property: 'og:url', content: canonical });
		setOrCreate('link[rel="canonical"]', { rel: 'canonical', href: canonical });

		setOrCreate('meta[name="twitter:card"]', {
			name: 'twitter:card',
			content: twitterCard,
		});
		setOrCreate('meta[name="twitter:title"]', {
			name: 'twitter:title',
			content: fullTitle,
		});
		if (description) {
			setOrCreate('meta[name="twitter:description"]', {
				name: 'twitter:description',
				content: description,
			});
		}
		if (meta.image) {
			setOrCreate('meta[name="twitter:image"]', {
				name: 'twitter:image',
				content: meta.image,
			});
		}
	}, [
		meta?.title,
		meta?.description,
		meta?.image,
		meta?.type,
		meta?.canonical,
		meta?.robots,
		meta?.twitterCard,
		meta?.siteName,
	]);
}

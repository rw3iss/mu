import { describe, expect, it } from 'vitest';
import { injectSeoHead, renderSeoHead, SEO_MARKER_END, SEO_MARKER_START } from '../seo-injector.js';

describe('renderSeoHead', () => {
	it('renders title + og + twitter tags', () => {
		const head = renderSeoHead({
			title: 'The Matrix (1999)',
			description: 'A computer hacker learns the truth.',
			image: 'https://image.tmdb.org/t/p/w500/abc.jpg',
			type: 'video.movie',
			canonical: 'https://mu.example.com/movie/1',
		});
		expect(head).toContain('<title>The Matrix (1999) — Mu</title>');
		expect(head).toContain('property="og:title"');
		expect(head).toContain('content="video.movie"');
		expect(head).toContain('property="og:image"');
		expect(head).toContain('https://image.tmdb.org/t/p/w500/abc.jpg');
		expect(head).toContain('name="twitter:card"');
		expect(head).toContain('content="summary_large_image"');
		expect(head).toContain('rel="canonical"');
	});

	it('escapes special characters in title and description', () => {
		const head = renderSeoHead({
			title: 'Tom & Jerry "Special"',
			description: 'A <story> with "quotes" & ampersands.',
		});
		expect(head).toContain('Tom &amp; Jerry &quot;Special&quot;');
		expect(head).toContain('A &lt;story&gt; with &quot;quotes&quot; &amp; ampersands.');
	});

	it('clamps long descriptions to ~200 chars', () => {
		const long = 'a'.repeat(500);
		const head = renderSeoHead({ title: 'X', description: long });
		const descMatch = head.match(/name="description" content="([^"]+)"/);
		expect(descMatch).toBeTruthy();
		expect(descMatch![1]!.length).toBeLessThanOrEqual(200);
		expect(descMatch![1]!).toMatch(/…$/);
	});

	it('defaults to noindex robots and summary card without image', () => {
		const head = renderSeoHead({ title: 'X' });
		expect(head).toContain('content="noindex,nofollow"');
		expect(head).toContain('content="summary"');
		expect(head).not.toContain('content="summary_large_image"');
	});

	it('omits the brand suffix when title equals site name', () => {
		const head = renderSeoHead({ title: 'Mu' });
		expect(head).toContain('<title>Mu</title>');
		expect(head).not.toContain('Mu — Mu');
	});
});

describe('injectSeoHead', () => {
	const html = `<html><head>${SEO_MARKER_START}<title>OLD</title>${SEO_MARKER_END}</head><body>x</body></html>`;

	it('replaces content between markers', () => {
		const out = injectSeoHead(html, `${SEO_MARKER_START}<title>NEW</title>${SEO_MARKER_END}`);
		expect(out).toContain('<title>NEW</title>');
		expect(out).not.toContain('<title>OLD</title>');
	});

	it('falls back to inserting before </head> when no markers present', () => {
		const noMarkers = '<html><head><title>X</title></head><body>y</body></html>';
		const out = injectSeoHead(noMarkers, '<meta name="extra"/>');
		expect(out).toMatch(/<meta name="extra"\/>\s*<\/head>/);
		expect(out).toContain('<title>X</title>');
	});
});

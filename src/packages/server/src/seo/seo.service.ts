import { Injectable, Logger } from '@nestjs/common';
import type { SeoMeta } from '@mu/shared';
import { eq } from 'drizzle-orm';
import { ShareTokenVerifier } from '../common/share-token.verifier.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
	movieMetadata,
	movies,
	people,
} from '../database/schema/index.js';
import { TmdbProvider } from '../metadata/providers/tmdb.provider.js';
import { injectSeoHead, renderSeoHead } from './seo-injector.js';

const DEFAULT_META: SeoMeta = {
	title: 'Mu',
	description: 'Self-hosted movie streaming and management.',
	type: 'website',
};

const HTML_CACHE_TTL_MS = 60_000;

interface CacheEntry {
	html: string;
	expiresAt: number;
}

/**
 * Resolves per-page SEO metadata and injects it into the SPA's
 * index.html. The Fastify SPA-fallback hook calls `renderForUrl`
 * with the request URL + raw HTML; the result is sent back to the
 * client (and cached briefly so repeated requests are cheap).
 *
 * Resolvers are matched in registration order. The first one whose
 * pattern matches wins; if none match, the default meta is used.
 */
@Injectable()
export class SeoService {
	private readonly logger = new Logger('SeoService');
	private readonly htmlCache = new Map<string, CacheEntry>();
	private readonly publicBaseUrl: string;

	constructor(
		private readonly database: DatabaseService,
		private readonly config: ConfigService,
		private readonly shareTokenVerifier: ShareTokenVerifier,
		private readonly tmdb: TmdbProvider,
	) {
		this.publicBaseUrl = this.resolvePublicBaseUrl();
	}

	private resolvePublicBaseUrl(): string {
		const cfg = this.config.get<string>('server.publicUrl', '');
		if (cfg) return cfg.replace(/\/+$/, '');
		const port = this.config.get<number>('server.port', 4000);
		const tlsOn = !!this.config.get('server.tls.certPath');
		const proto = tlsOn ? 'https' : 'http';
		return `${proto}://localhost:${port}`;
	}

	/**
	 * Resolve the meta for a given pathname.
	 *
	 * @param pathname URL path (no query string)
	 * @param fastifyInstance Needed to verify share-tokens; pass
	 *   `request.server` from the Fastify hook.
	 */
	async resolveMeta(
		pathname: string,
		fastifyInstance: any,
		requestOrigin?: string,
	): Promise<SeoMeta> {
		const path = pathname.split('?')[0]?.replace(/\/+$/, '') || '/';
		const baseUrl = requestOrigin || this.publicBaseUrl;

		// /movie/:key  (UUID or namespaced like tmdb:603)
		const movieMatch = path.match(/^\/movie\/([^/]+)/);
		if (movieMatch) {
			const m = await this.resolveMovie(movieMatch[1]!, baseUrl);
			if (m) return this.withCanonical(m, path, baseUrl);
		}

		// /person/:key
		const personMatch = path.match(/^\/person\/([^/]+)/);
		if (personMatch) {
			const p = await this.resolvePerson(decodeURIComponent(personMatch[1]!), baseUrl);
			if (p) return this.withCanonical(p, path, baseUrl);
		}

		// /watch/:token
		const watchMatch = path.match(/^\/watch\/([^/]+)/);
		if (watchMatch) {
			const w = await this.resolveWatch(watchMatch[1]!, fastifyInstance, baseUrl);
			if (w) return this.withCanonical(w, path, baseUrl);
		}

		// Static SPA routes — built-ins so the tab title is right.
		const staticTitle = STATIC_ROUTE_TITLES[path];
		if (staticTitle) {
			return this.withCanonical(
				{ ...DEFAULT_META, title: staticTitle },
				path,
				baseUrl,
			);
		}

		return this.withCanonical(DEFAULT_META, path, baseUrl);
	}

	private withCanonical(meta: SeoMeta, path: string, baseUrl: string): SeoMeta {
		return { ...meta, canonical: meta.canonical ?? `${baseUrl}${path}` };
	}

	private async resolveMovie(rawKey: string, baseUrl: string): Promise<SeoMeta | null> {
		const key = decodeURIComponent(rawKey);
		// Look up by UUID first, then by tmdbId for `tmdb:N` style keys.
		let row: any = null;
		let tmdbIdForFallback: number | null = null;
		if (!key.includes(':')) {
			row = this.database.db.select().from(movies).where(eq(movies.id, key)).get();
		} else if (key.startsWith('tmdb:')) {
			const tmdbId = Number.parseInt(key.slice(5), 10);
			if (Number.isFinite(tmdbId)) {
				tmdbIdForFallback = tmdbId;
				row = this.database.db
					.select()
					.from(movies)
					.where(eq(movies.tmdbId, tmdbId))
					.get();
			}
		}

		if (row) {
			const meta = this.database.db
				.select()
				.from(movieMetadata)
				.where(eq(movieMetadata.movieId, row.id))
				.get();

			const title = row.year ? `${row.title} (${row.year})` : row.title;
			const description =
				row.overview ??
				(meta?.imdbRating || meta?.tmdbRating ? `Movie · ${title}` : undefined);
			const image = this.absUrl(row.posterUrl ?? row.backdropUrl ?? null, baseUrl);

			return {
				title,
				description: description ?? undefined,
				image: image ?? undefined,
				type: 'video.movie',
			};
		}

		// No local row, but the URL referenced a TMDB id — fetch directly
		// from TMDB so the share preview still works for never-visited
		// movies. Read-only (no DB write); the TmdbProvider's own LRU
		// cache absorbs repeat hits. When a real user later navigates to
		// the page, MoviesService.findOrFetchByKey will create the stub
		// row and subsequent resolves go through the fast DB path.
		if (tmdbIdForFallback != null) {
			try {
				const details = await this.tmdb.getMovieDetails(tmdbIdForFallback);
				if (details) {
					const year = details.release_date
						? Number.parseInt(details.release_date.slice(0, 4), 10)
						: null;
					const title = year && Number.isFinite(year)
						? `${details.title} (${year})`
						: details.title;
					return {
						title,
						description: details.overview ?? undefined,
						image: details.poster_path
							? `https://image.tmdb.org/t/p/w500${details.poster_path}`
							: undefined,
						type: 'video.movie',
					};
				}
			} catch (err: any) {
				this.logger.debug?.(
					`SEO TMDB fallback failed for tmdb:${tmdbIdForFallback}: ${err?.message ?? err}`,
				);
			}
		}

		return null;
	}

	private async resolvePerson(key: string, baseUrl: string): Promise<SeoMeta | null> {
		const row = this.database.db
			.select()
			.from(people)
			.where(eq(people.externalId, key))
			.get();
		if (!row) return null;

		const description = row.biography
			? String(row.biography).slice(0, 200)
			: row.knownForDepartment
				? `${row.knownForDepartment}${row.placeOfBirth ? ` · ${row.placeOfBirth}` : ''}`
				: undefined;
		const image = this.absUrl(row.profileUrl, baseUrl);

		return {
			title: row.name,
			description: description ?? undefined,
			image: image ?? undefined,
			type: 'profile',
		};
	}

	private async resolveWatch(
		rawToken: string,
		fastifyInstance: any,
		baseUrl: string,
	): Promise<SeoMeta | null> {
		try {
			const token = decodeURIComponent(rawToken);
			const payload = this.shareTokenVerifier.verify(token, fastifyInstance);
			if (!payload?.movieId) return null;
			const movie = this.database.db
				.select()
				.from(movies)
				.where(eq(movies.id, payload.movieId))
				.get();
			if (!movie) return null;
			const title = movie.year
				? `Watch: ${movie.title} (${movie.year})`
				: `Watch: ${movie.title}`;
			return {
				title,
				description:
					movie.overview ?? 'A movie shared from a private Mu library.',
				image: this.absUrl(movie.posterUrl ?? movie.backdropUrl ?? null, baseUrl) ?? undefined,
				type: 'video.other',
				// Public shared content can be indexed by social-card bots
				// but we still don't want it in Google. `noindex,follow`
				// lets crawlers traverse but not list.
				robots: 'noindex,follow',
			};
		} catch (err: any) {
			this.logger.debug?.(`Watch token decode failed: ${err?.message ?? err}`);
			return null;
		}
	}

	/**
	 * Make a poster/profile URL absolute. Relative `/api/v1/media/...`
	 * paths get the request's origin prepended; absolute URLs (TMDB CDN)
	 * pass through unchanged.
	 */
	private absUrl(u: string | null | undefined, baseUrl: string): string | null {
		if (!u) return null;
		if (/^https?:\/\//i.test(u)) return u;
		if (u.startsWith('/')) return `${baseUrl}${u}`;
		return `${baseUrl}/${u}`;
	}

	/**
	 * Resolve + render + inject. Cached by (origin + path) for 60s so
	 * a crawler hammering the same URL doesn't re-query the DB.
	 *
	 * @param requestOrigin e.g. `https://mu.example.com:4000` —
	 *   derived from the request's Host header so og:url + canonical
	 *   reflect the actual public URL. Falls back to the configured
	 *   `server.publicUrl` when not supplied.
	 */
	async renderForUrl(
		pathname: string,
		rawHtml: string,
		fastifyInstance: any,
		requestOrigin?: string,
	): Promise<string> {
		const now = Date.now();
		const cacheKey = `${requestOrigin ?? ''}|${pathname}`;
		const cached = this.htmlCache.get(cacheKey);
		if (cached && cached.expiresAt > now) return cached.html;

		try {
			const meta = await this.resolveMeta(pathname, fastifyInstance, requestOrigin);
			const head = renderSeoHead(meta);
			const html = injectSeoHead(rawHtml, head);
			this.htmlCache.set(cacheKey, { html, expiresAt: now + HTML_CACHE_TTL_MS });
			// Cap cache size — simplest possible LRU: when over the
			// limit, drop the oldest 100 entries by insertion order.
			if (this.htmlCache.size > 500) {
				const drop = Array.from(this.htmlCache.keys()).slice(0, 100);
				for (const k of drop) this.htmlCache.delete(k);
			}
			return html;
		} catch (err: any) {
			this.logger.warn(`SEO render failed for ${pathname}: ${err?.message ?? err}`);
			return rawHtml;
		}
	}

	/** Test hook: clear cached HTML. */
	clearCache(): void {
		this.htmlCache.clear();
	}
}

const STATIC_ROUTE_TITLES: Record<string, string> = {
	'/': 'Mu',
	'/library': 'Library',
	'/discover': 'Discover',
	'/watchlist': 'Watchlist',
	'/favorites': 'Favorites',
	'/recent': 'Recently Watched',
	'/settings': 'Settings',
	'/admin': 'Admin',
	'/login': 'Sign in',
};

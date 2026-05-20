import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service.js';
import type {
	Enricher,
	EnrichField,
	EnrichResult,
	HealthStatus,
	MovieSeed,
	Searcher,
	SearchHit,
	SearchQuery,
} from '../../provider.interface.js';
import { ProviderCredentialsService } from '../../provider-credentials.service.js';
import { ProviderEventsService } from '../../provider-events.service.js';
import { ProviderRegistry } from '../../provider-registry.service.js';
import { RateLimitService } from '../../rate-limit.service.js';
import { WikidataHttpClient } from './wikidata.http-client.js';
import type { WikidataCredentials } from './wikidata.types.js';

/**
 * Wikidata SPARQL source.
 *
 * Capabilities:
 *   - `search` — title→candidates lookup, returns cross-source IDs
 *     (TMDB, IMDB, Trakt slug, TVDB) in one shot. Free, no key.
 *   - `enrich` — given a seed with imdbId/tmdbId, return additional
 *     identifiers, original-language hint, genre P136 labels, "based
 *     on" / awards. Engine merges via MergeEngine with appropriate
 *     precedence (mostly LOWER than TMDB/OMDB — Wikidata is great
 *     for cross-IDs but its plot/poster fields are sparse).
 *
 * Why it's a high-value first-class source despite being free:
 *   - One query resolves "this movie's TMDB id + IMDB id + Trakt id
 *     + TVDB id" — back-fills our movie_identities for everything
 *     downstream.
 *   - Awards / nominations not in TMDB or OMDB.
 *   - "Based on" relations (book → film, comic → film) for
 *     adaptation-aware recommendations.
 *
 * SOLID:
 *   - SRP: this class owns the Wikidata client wiring + the SPARQL
 *     prompts. Result→canonical mapping is a small helper, kept
 *     in-file (it's source-specific by nature).
 *   - OCP: capability set is declared; adding 'recommend' or
 *     'explain' later is a new method, no changes to existing.
 *   - LSP: any Searcher/Enricher consumer can substitute this
 *     class — no provider-specific contracts leak past the
 *     interface boundary.
 *   - DIP: relies on injected ProviderRegistry / CredentialsService
 *     / RateLimitService / CacheService — no Wikidata-specific
 *     globals.
 */
@Injectable()
export class WikidataProvider implements Searcher, Enricher, OnModuleInit {
	readonly id = 'wikidata';
	readonly displayName = 'Wikidata';
	readonly description =
		'Free SPARQL endpoint. One-shot cross-ID resolution (TMDB/IMDB/Trakt/TVDB), genres, awards, "based on" relations.';
	readonly capabilities = new Set(['search', 'enrich'] as const);
	readonly auth = 'none' as const;
	readonly configFields = [
		{
			key: 'userAgent',
			label: 'User-Agent string',
			description:
				'Optional. Identifies your instance to Wikidata staff. Defaults to "mu-cinehost/1.0" if blank. They appreciate self-identifying strings for any deployment running queries beyond casual use.',
			type: 'string' as const,
			required: false,
		},
	];
	readonly rateLimit = {
		// Wikidata accepts unauthenticated traffic generously but their
		// formal cap is "use sane queries". We throttle to 2/s and
		// 60/min to stay polite — large back-fills will queue.
		perSecond: 2,
		perMinute: 60,
		perDay: 50_000,
	};

	private readonly logger = new Logger('WikidataProvider');

	constructor(
		private readonly registry: ProviderRegistry,
		private readonly credentials: ProviderCredentialsService,
		private readonly rateLimitService: RateLimitService,
		private readonly events: ProviderEventsService,
		private readonly cache: CacheService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	isConfigured(): boolean {
		// Wikidata works key-less. We treat the provider as configured
		// the moment the user enables it (even with a blank config) so
		// the registry includes it in the configured-providers list.
		const row = this.credentials.getRaw(this.id);
		return row !== null && row !== undefined;
	}

	async healthCheck(): Promise<HealthStatus> {
		const started = Date.now();
		try {
			const client = this.client();
			// `LIMIT 1` probe with a stable, well-known entity (The Matrix).
			const rows = await client.query(
				`SELECT ?film WHERE { ?film wdt:P345 "tt0133093" } LIMIT 1`,
			);
			const ok = rows.length > 0;
			this.events.record({
				providerId: this.id,
				type: 'health_check',
				durationMs: Date.now() - started,
			});
			return {
				ok,
				detail: ok ? undefined : 'Empty probe result',
				checkedAt: new Date().toISOString(),
			};
		} catch (e: any) {
			this.events.record({
				providerId: this.id,
				type: 'error',
				payload: { stage: 'health_check', detail: String(e?.message ?? e) },
			});
			return {
				ok: false,
				detail: String(e?.message ?? e),
				checkedAt: new Date().toISOString(),
			};
		}
	}

	// ---------------------------------------------------------------------
	// Searcher
	// ---------------------------------------------------------------------
	async search(query: SearchQuery, limit = 10): Promise<SearchHit[]> {
		await this.rateLimitService.acquire(this.id);
		const cacheKey = `search:${query.imdbId ?? ''}:${query.tmdbId ?? ''}:${query.title}:${query.year ?? ''}:${limit}`;
		const cached = await this.cache.get<SearchHit[]>('wikidata', cacheKey);
		if (cached) return cached;

		// If we have an external id, the query is trivially small.
		const sparql = query.imdbId
			? this.lookupByImdbSparql(query.imdbId)
			: query.tmdbId
				? this.lookupByTmdbSparql(query.tmdbId)
				: this.searchByTitleSparql(query.title, query.year, limit);

		try {
			const rows = await this.client().query<{
				film: string;
				filmLabel?: string;
				imdb?: string;
				tmdb?: string;
				trakt?: string;
				tvdb?: string;
				year?: string;
				runtime?: string;
			}>(sparql);
			const hits: SearchHit[] = rows.map((r) => {
				const externalIds: Record<string, string | number> = {
					wikidata: stripWdPrefix(r.film),
				};
				if (r.imdb) externalIds.imdb = r.imdb;
				if (r.tmdb) {
					const n = Number(r.tmdb);
					externalIds.tmdb = Number.isFinite(n) ? n : r.tmdb;
				}
				if (r.trakt) externalIds.trakt = r.trakt;
				if (r.tvdb) externalIds.tvdb = r.tvdb;
				const year = r.year ? parseInt(r.year.slice(0, 4), 10) : null;
				return {
					sourceId: this.id,
					title: r.filmLabel ?? '(unknown)',
					year: Number.isFinite(year ?? NaN) ? year : null,
					durationMinutes: r.runtime ? parseInt(r.runtime, 10) : null,
					externalIds,
					// Wikidata is exact-match when queried by id; for
					// title search we fall back to a flat confidence
					// since the SPARQL result doesn't surface a score.
					confidence: query.imdbId || query.tmdbId ? 1 : 0.6,
					raw: r,
				};
			});
			this.events.record({ providerId: this.id, type: 'call', payload: { stage: 'search' } });
			await this.cache.set('wikidata', cacheKey, hits, 60 * 60 * 24);
			return hits;
		} catch (e: any) {
			this.events.record({
				providerId: this.id,
				type: 'error',
				payload: { stage: 'search', detail: String(e?.message ?? e) },
			});
			return [];
		}
	}

	// ---------------------------------------------------------------------
	// Enricher
	// ---------------------------------------------------------------------
	async enrich(movie: MovieSeed, _want: ReadonlySet<EnrichField>): Promise<EnrichResult> {
		// Wikidata's strength is cross-IDs + extras; we map onto the
		// EnrichResult shape's permissive `keywords` / `tags` /
		// `comparables` fields. The MergeEngine handles per-field
		// precedence; Wikidata's keys live at low weight so it's only
		// a fallback for fields TMDB/OMDB don't already supply.
		if (!movie.imdbId && !movie.tmdbId) return {};
		await this.rateLimitService.acquire(this.id);
		const sparql = movie.imdbId
			? this.lookupByImdbSparql(movie.imdbId, /* withExtras */ true)
			: this.lookupByTmdbSparql(movie.tmdbId!, /* withExtras */ true);

		try {
			const rows = await this.client().query<{
				film: string;
				filmLabel?: string;
				imdb?: string;
				tmdb?: string;
				trakt?: string;
				tvdb?: string;
				genreLabel?: string;
				basedOnLabel?: string;
				awardLabel?: string;
			}>(sparql);
			if (rows.length === 0) return {};
			const tags = new Set<string>();
			const keywords = new Set<string>();
			const comparables = new Set<string>();
			for (const r of rows) {
				if (r.genreLabel) keywords.add(r.genreLabel);
				if (r.awardLabel) tags.add(`Award: ${r.awardLabel}`);
				if (r.basedOnLabel) comparables.add(r.basedOnLabel);
			}
			this.events.record({ providerId: this.id, type: 'call', payload: { stage: 'enrich' } });
			return {
				keywords: keywords.size ? Array.from(keywords) : undefined,
				tags: tags.size ? Array.from(tags) : undefined,
				comparables: comparables.size ? Array.from(comparables) : undefined,
			};
		} catch (e: any) {
			this.events.record({
				providerId: this.id,
				type: 'error',
				payload: { stage: 'enrich', detail: String(e?.message ?? e) },
			});
			return {};
		}
	}

	// ---------------------------------------------------------------------
	// SPARQL prompts. Kept as private members so they're easy to tune
	// without touching the orchestration above.
	// ---------------------------------------------------------------------
	private lookupByImdbSparql(imdbId: string, withExtras = false): string {
		const sanitized = imdbId.replace(/"/g, '');
		return `
			SELECT DISTINCT ?film ?filmLabel ?imdb ?tmdb ?trakt ?tvdb ?year ?runtime
				${withExtras ? '?genreLabel ?basedOnLabel ?awardLabel' : ''}
			WHERE {
				?film wdt:P345 "${sanitized}" .
				OPTIONAL { ?film wdt:P345 ?imdb }
				OPTIONAL { ?film wdt:P4947 ?tmdb }
				OPTIONAL { ?film wdt:P11460 ?trakt }
				OPTIONAL { ?film wdt:P12196 ?tvdb }
				OPTIONAL { ?film wdt:P577 ?year }
				OPTIONAL { ?film wdt:P2047 ?runtime }
				${
					withExtras
						? `
				OPTIONAL { ?film wdt:P136 ?genre . ?genre rdfs:label ?genreLabel FILTER(LANG(?genreLabel) = "en") }
				OPTIONAL { ?film wdt:P144 ?basedOn . ?basedOn rdfs:label ?basedOnLabel FILTER(LANG(?basedOnLabel) = "en") }
				OPTIONAL { ?film wdt:P166 ?award . ?award rdfs:label ?awardLabel FILTER(LANG(?awardLabel) = "en") }
				`
						: ''
				}
				SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
			}
			LIMIT ${withExtras ? 50 : 1}
		`;
	}

	private lookupByTmdbSparql(tmdbId: number, withExtras = false): string {
		const id = String(tmdbId);
		return `
			SELECT DISTINCT ?film ?filmLabel ?imdb ?tmdb ?trakt ?tvdb ?year ?runtime
				${withExtras ? '?genreLabel ?basedOnLabel ?awardLabel' : ''}
			WHERE {
				?film wdt:P4947 "${id}" .
				OPTIONAL { ?film wdt:P345 ?imdb }
				BIND("${id}" AS ?tmdb)
				OPTIONAL { ?film wdt:P11460 ?trakt }
				OPTIONAL { ?film wdt:P12196 ?tvdb }
				OPTIONAL { ?film wdt:P577 ?year }
				OPTIONAL { ?film wdt:P2047 ?runtime }
				${
					withExtras
						? `
				OPTIONAL { ?film wdt:P136 ?genre . ?genre rdfs:label ?genreLabel FILTER(LANG(?genreLabel) = "en") }
				OPTIONAL { ?film wdt:P144 ?basedOn . ?basedOn rdfs:label ?basedOnLabel FILTER(LANG(?basedOnLabel) = "en") }
				OPTIONAL { ?film wdt:P166 ?award . ?award rdfs:label ?awardLabel FILTER(LANG(?awardLabel) = "en") }
				`
						: ''
				}
				SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
			}
			LIMIT ${withExtras ? 50 : 1}
		`;
	}

	private searchByTitleSparql(
		title: string,
		year: number | null | undefined,
		limit: number,
	): string {
		// Title search uses entity-label match constrained to films
		// (Q11424). Year proximity isn't expressible cheaply in SPARQL
		// — we ask Wikidata for the publication year and let the
		// matcher score upstream. Restrict to small `limit` since
		// SPARQL is heavy.
		const sanitized = title.replace(/"/g, '');
		const yearFilter = year
			? `FILTER(YEAR(?year) >= ${year - 2} && YEAR(?year) <= ${year + 2})`
			: '';
		return `
			SELECT DISTINCT ?film ?filmLabel ?imdb ?tmdb ?trakt ?tvdb ?year
			WHERE {
				?film wdt:P31/wdt:P279* wd:Q11424 ;
					rdfs:label ?label .
				FILTER(LANG(?label) = "en")
				FILTER(CONTAINS(LCASE(?label), LCASE("${sanitized}")))
				OPTIONAL { ?film wdt:P345 ?imdb }
				OPTIONAL { ?film wdt:P4947 ?tmdb }
				OPTIONAL { ?film wdt:P11460 ?trakt }
				OPTIONAL { ?film wdt:P12196 ?tvdb }
				OPTIONAL { ?film wdt:P577 ?year }
				${yearFilter}
				SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
			}
			LIMIT ${limit}
		`;
	}

	private client(): WikidataHttpClient {
		const creds = this.credentials.getRaw(this.id) as WikidataCredentials | null;
		return new WikidataHttpClient(creds?.userAgent);
	}
}

function stripWdPrefix(entityUrl: string): string {
	const idx = entityUrl.lastIndexOf('/');
	return idx >= 0 ? entityUrl.slice(idx + 1) : entityUrl;
}

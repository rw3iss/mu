/**
 * Provider abstraction — the single contract every external source
 * (recommendation API, metadata enricher, embedder, LLM client)
 * implements. Cross-cutting concerns (rate limiting, credentials,
 * health checks, observability) consume providers through these
 * interfaces and never reach for a concrete class.
 *
 * Adding a new source means: implement the relevant interface(s),
 * decorate with @RegisterProvider, list in a NestJS module's
 * providers array. The orchestrator, settings UI, rate limiter and
 * audit log pick it up automatically.
 */

/** The kinds of work a provider can perform. */
export type Capability =
	| 'recommend'
	| 'enrich'
	| 'embed'
	| 'rerank'
	| 'explain';

/** Shape of a config field a provider declares for the admin UI. */
export interface ConfigFieldSpec {
	/** Key in the provider_credentials.config JSON object. */
	key: string;
	/** Label displayed in the UI. */
	label: string;
	/** Free-form description / placeholder text. */
	description?: string;
	/**
	 * `secret` masks the value in API responses and renders it as a
	 * password input. `string` is plain text. `number` is a numeric
	 * input. `boolean` is a checkbox.
	 */
	type: 'string' | 'secret' | 'number' | 'boolean';
	required?: boolean;
	defaultValue?: unknown;
}

/**
 * Declarative rate-limit / budget spec. Consumed by RateLimitService;
 * providers never implement throttling themselves.
 */
export interface RateLimitSpec {
	perSecond?: number;
	perMinute?: number;
	perDay?: number;
	perMonth?: number;
	/** Estimated USD per call, used for budget calculations. */
	costPerCall?: number;
	/** Hard ceiling — refuse new calls when projected spend exceeds this. */
	monthlyBudgetUsd?: number;
}

export interface HealthStatus {
	ok: boolean;
	detail?: string;
	/** ISO timestamp of when the check ran. */
	checkedAt: string;
}

/**
 * Shared by every provider. Implementations declare metadata
 * (capabilities, auth, config schema, rate-limit spec) and expose
 * lifecycle hooks (`isConfigured`, `healthCheck`). Capability-
 * specific methods live on the sub-interfaces below.
 */
export interface Provider {
	readonly id: string;
	readonly displayName: string;
	readonly description?: string;
	readonly capabilities: ReadonlySet<Capability>;
	readonly auth: 'apiKey' | 'oauth' | 'none';
	readonly configFields: readonly ConfigFieldSpec[];
	readonly rateLimit: RateLimitSpec;
	isConfigured(): boolean;
	healthCheck(): Promise<HealthStatus>;
}

// =========================================================================
// Capability sub-interfaces — providers implement whichever apply.
// =========================================================================

/** A movie, in the minimum shape providers need to reason about it. */
export interface MovieSeed {
	id: string;
	title: string;
	year?: number | null;
	tmdbId?: number | null;
	imdbId?: string | null;
	overview?: string | null;
	genres?: string[];
	cast?: string[];
	directors?: string[];
	keywords?: string[];
}

export interface Recommendation {
	/** Local movie id if the target is in our library. */
	movieId?: string;
	tmdbId?: number;
	imdbId?: string;
	title: string;
	year?: number | null;
	score: number;
	explanation?: string;
	posterUrl?: string;
	/** Provider-specific raw payload, kept for downstream re-mining. */
	raw?: unknown;
}

export interface Recommender extends Provider {
	recommend(seed: MovieSeed, k: number): Promise<Recommendation[]>;
}

export type EnrichField =
	| 'keywords'
	| 'tags'
	| 'themes'
	| 'ratings'
	| 'comparables';

export interface EnrichResult {
	keywords?: string[];
	tags?: string[];
	themes?: string[];
	ratings?: Record<string, number>;
	comparables?: string[];
}

export interface Enricher extends Provider {
	enrich(movie: MovieSeed, want: ReadonlySet<EnrichField>): Promise<EnrichResult>;
}

export interface Embedder extends Provider {
	readonly model: string;
	readonly dim: number;
	embed(texts: string[]): Promise<Float32Array[]>;
}

export interface MovieFeatures {
	tone?: string;
	pace?: string;
	themes?: string[];
	audience?: string;
	comparables?: string[];
	/** Raw model output, for re-extraction without re-billing. */
	raw?: unknown;
}

export interface RankedResult {
	movieId?: string;
	tmdbId?: number;
	imdbId?: string;
	title: string;
	score: number;
	explanation?: string;
}

export interface LLMClient extends Provider {
	rerank(
		seed: MovieSeed,
		candidates: MovieSeed[],
		opts?: { withWhy?: boolean },
	): Promise<RankedResult[]>;
	features(movie: MovieSeed): Promise<MovieFeatures>;
	explain(seed: MovieSeed, target: MovieSeed): Promise<string>;
}

// =========================================================================
// Type guards — used by the registry to filter by capability.
// =========================================================================

export function isRecommender(p: Provider): p is Recommender {
	return p.capabilities.has('recommend');
}

export function isEnricher(p: Provider): p is Enricher {
	return p.capabilities.has('enrich');
}

export function isEmbedder(p: Provider): p is Embedder {
	return p.capabilities.has('embed');
}

export function isLLMClient(p: Provider): p is LLMClient {
	return p.capabilities.has('rerank') || p.capabilities.has('explain');
}

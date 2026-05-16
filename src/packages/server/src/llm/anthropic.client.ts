import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BudgetExhausted, RateLimitExceeded } from '../providers/exceptions.js';
import type {
	LLMClient,
	MovieFeatures,
	MovieSeed,
	RankedResult,
} from '../providers/provider.interface.js';
import { ProviderCredentialsService } from '../providers/provider-credentials.service.js';
import { ProviderEventsService } from '../providers/provider-events.service.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { RateLimitService } from '../providers/rate-limit.service.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

interface AnthropicCredentials {
	apiKey: string;
	model?: string;
	monthlyBudgetUsd?: number;
}

/**
 * Anthropic Claude client implementing the Phase 0 `LLMClient`
 * contract. Used as a re-ranker, feature extractor, and explanation
 * generator. Prompt caching ensures repeat rerank calls against the
 * same seed cost a small fraction of the first call.
 *
 * Architecture is generic — adding OpenAI / Ollama / etc. is a sibling
 * class implementing the same interface + module registration. The
 * orchestrator never imports a concrete client.
 */
@Injectable()
export class AnthropicClient implements LLMClient, OnModuleInit {
	readonly id = 'anthropic';
	readonly displayName = 'Anthropic (Claude)';
	readonly description =
		'Claude Haiku / Sonnet for movie re-ranking, feature extraction (tone, themes, audience), and one-line "why" explanations. Paid; sub-cent per call with prompt caching.';
	readonly capabilities = new Set(['rerank', 'explain'] as const);
	readonly auth = 'apiKey' as const;
	readonly configFields = [
		{
			key: 'apiKey',
			label: 'API Key',
			description: 'sk-ant-… from console.anthropic.com',
			type: 'secret' as const,
			required: true,
		},
		{
			key: 'model',
			label: 'Model',
			description: `Default: ${DEFAULT_MODEL}. Use claude-sonnet-4-6 for higher-quality feature extraction.`,
			type: 'string' as const,
			required: false,
		},
		{
			key: 'monthlyBudgetUsd',
			label: 'Monthly budget (USD)',
			description: 'Hard ceiling — calls refused once projected month spend exceeds this.',
			type: 'number' as const,
			required: false,
			defaultValue: 5,
		},
	];
	// Conservative defaults. Effective ceiling overridden per-credential
	// once `monthlyBudgetUsd` is read on first call.
	readonly rateLimit = {
		perSecond: 5,
		perMinute: 50,
		costPerCall: 0.001,
		monthlyBudgetUsd: 5,
	};

	private readonly logger = new Logger('AnthropicClient');

	constructor(
		private readonly registry: ProviderRegistry,
		private readonly credentials: ProviderCredentialsService,
		private readonly rateLimitService: RateLimitService,
		private readonly events: ProviderEventsService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	isConfigured(): boolean {
		const creds = this.credentials.getRaw(this.id) as AnthropicCredentials | null;
		return !!creds?.apiKey;
	}

	async healthCheck() {
		const creds = this.credentials.getRaw(this.id) as AnthropicCredentials | null;
		if (!creds?.apiKey) {
			return { ok: false, detail: 'Not configured', checkedAt: new Date().toISOString() };
		}
		try {
			const result = await this.call(creds, 'Say "ok".', 4);
			const ok = !!result.text;
			return {
				ok,
				detail: ok ? `Model ${creds.model ?? DEFAULT_MODEL} responded` : 'Empty response',
				checkedAt: new Date().toISOString(),
			};
		} catch (err: any) {
			return {
				ok: false,
				detail: err?.message ?? 'unknown',
				checkedAt: new Date().toISOString(),
			};
		}
	}

	async rerank(
		seed: MovieSeed,
		candidates: MovieSeed[],
		opts?: { withWhy?: boolean },
	): Promise<RankedResult[]> {
		const creds = this.credentials.getRaw(this.id) as AnthropicCredentials | null;
		if (!creds?.apiKey || candidates.length === 0) return [];

		const prompt = buildRerankPrompt(seed, candidates, opts?.withWhy ?? false);
		const result = await this.guardedCall(creds, prompt, 800);
		try {
			const parsed = JSON.parse(stripCodeFence(result.text));
			if (!Array.isArray(parsed)) return [];
			return parsed
				.map((p: any, idx: number) => ({
					movieId: p?.id ?? candidates[idx]?.id ?? '',
					title: p?.title ?? candidates[idx]?.title ?? '',
					score: typeof p?.score === 'number' ? p.score : 1 - idx / candidates.length,
					explanation: typeof p?.why === 'string' ? p.why : undefined,
				}))
				.filter((r: any) => r.movieId);
		} catch (err: any) {
			this.logger.warn(`rerank() parse error: ${err?.message}`);
			return [];
		}
	}

	async features(movie: MovieSeed): Promise<MovieFeatures> {
		const creds = this.credentials.getRaw(this.id) as AnthropicCredentials | null;
		if (!creds?.apiKey) return {};
		const prompt = buildFeaturesPrompt(movie);
		const result = await this.guardedCall(creds, prompt, 400);
		try {
			const parsed = JSON.parse(stripCodeFence(result.text));
			return {
				tone: typeof parsed?.tone === 'string' ? parsed.tone : undefined,
				pace: typeof parsed?.pace === 'string' ? parsed.pace : undefined,
				themes: Array.isArray(parsed?.themes) ? parsed.themes.map(String) : undefined,
				audience: typeof parsed?.audience === 'string' ? parsed.audience : undefined,
				comparables: Array.isArray(parsed?.comparables)
					? parsed.comparables.map(String)
					: undefined,
				raw: parsed,
			};
		} catch (err: any) {
			this.logger.warn(`features() parse error: ${err?.message}`);
			return {};
		}
	}

	async explain(seed: MovieSeed, target: MovieSeed): Promise<string> {
		const creds = this.credentials.getRaw(this.id) as AnthropicCredentials | null;
		if (!creds?.apiKey) return '';
		const prompt = buildExplainPrompt(seed, target);
		const result = await this.guardedCall(creds, prompt, 80);
		return result.text.trim().replace(/^["']|["']$/g, '');
	}

	// =====================================================================
	// HTTP
	// =====================================================================

	private async guardedCall(
		creds: AnthropicCredentials,
		userPrompt: string,
		maxTokens: number,
	): Promise<{ text: string; costUsd: number }> {
		// Apply caller-set monthly cap, falling back to provider default.
		const dynamicCap = creds.monthlyBudgetUsd ?? this.rateLimit.monthlyBudgetUsd;
		const snap = this.rateLimitService.snapshot(this.id);
		if (dynamicCap != null && snap.monthCost >= dynamicCap) {
			this.events.record({
				providerId: this.id,
				type: 'budget_exhausted',
				payload: { spent: snap.monthCost, ceiling: dynamicCap },
			});
			throw new BudgetExhausted(this.id, snap.monthCost, dynamicCap);
		}

		try {
			await this.rateLimitService.acquire(this.id);
		} catch (err) {
			if (err instanceof RateLimitExceeded || err instanceof BudgetExhausted) {
				this.events.record({
					providerId: this.id,
					type: err instanceof BudgetExhausted ? 'budget_exhausted' : 'rate_limit',
				});
				throw err;
			}
			throw err;
		}

		const started = Date.now();
		const result = await this.call(creds, userPrompt, maxTokens);
		const durationMs = Date.now() - started;
		this.rateLimitService.record(this.id, 1, result.costUsd);
		this.events.record({
			providerId: this.id,
			type: 'call',
			statusCode: 200,
			durationMs,
			costUsd: result.costUsd,
		});
		return result;
	}

	private async call(
		creds: AnthropicCredentials,
		userPrompt: string,
		maxTokens: number,
	): Promise<{ text: string; costUsd: number }> {
		const model = creds.model || DEFAULT_MODEL;
		const res = await fetch(API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': creds.apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				messages: [{ role: 'user', content: userPrompt }],
			}),
		});

		if (res.status === 429) {
			throw new RateLimitExceeded(this.id, 'minute', 60_000);
		}
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
		}
		const data = (await res.json()) as {
			content?: Array<{ type: string; text?: string }>;
			usage?: { input_tokens: number; output_tokens: number };
		};
		const text =
			data.content
				?.filter((c) => c.type === 'text')
				.map((c) => c.text ?? '')
				.join('') ?? '';
		const costUsd = estimateCost(
			model,
			data.usage?.input_tokens ?? 0,
			data.usage?.output_tokens ?? 0,
		);
		return { text, costUsd };
	}
}

// =========================================================================
// Prompt builders + cost
// =========================================================================

function buildRerankPrompt(seed: MovieSeed, candidates: MovieSeed[], withWhy: boolean): string {
	const seedBlock = movieBlock(seed);
	const candBlock = candidates
		.map((c, i) => `${i + 1}. id=${c.id} | ${c.title}${c.year ? ` (${c.year})` : ''}`)
		.join('\n');
	const whyHint = withWhy ? `Include a one-sentence "why" per result.` : `Omit the "why" field.`;
	return `Re-rank these movies by how similar they are to the SEED. Consider tone, theme, plot mechanics, and emotional register — not just genre.

SEED:
${seedBlock}

CANDIDATES:
${candBlock}

${whyHint} Return ONLY a JSON array of objects with keys: id, title, score (0..1), why. Best matches first. No prose.`;
}

function buildFeaturesPrompt(movie: MovieSeed): string {
	return `Extract structured features for this movie. Return ONLY a JSON object with keys: tone (one or two words), pace (slow/measured/brisk/frenetic), themes (3-5 short strings), audience (prestige/popcorn/cult/family/arthouse), comparables (3-5 well-known movies).

MOVIE:
${movieBlock(movie)}

JSON only. No prose.`;
}

function buildExplainPrompt(seed: MovieSeed, target: MovieSeed): string {
	return `One sentence — no more than 20 words — explaining why someone who liked the SEED would enjoy the TARGET. Focus on the deepest shared signal (tone, theme, plot mechanic) rather than surface-level genre.

SEED: ${seed.title}${seed.year ? ` (${seed.year})` : ''}${seed.overview ? `\nPlot: ${seed.overview.slice(0, 400)}` : ''}

TARGET: ${target.title}${target.year ? ` (${target.year})` : ''}${target.overview ? `\nPlot: ${target.overview.slice(0, 400)}` : ''}

Just the sentence. No prefix, no quotes.`;
}

function movieBlock(m: MovieSeed): string {
	const parts = [
		`Title: ${m.title}${m.year ? ` (${m.year})` : ''}`,
		m.genres?.length ? `Genres: ${m.genres.join(', ')}` : null,
		m.directors?.length ? `Director: ${m.directors.join(', ')}` : null,
		m.overview ? `Plot: ${m.overview.slice(0, 500)}` : null,
	];
	return parts.filter(Boolean).join('\n');
}

function stripCodeFence(text: string): string {
	const fence = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
	return fence ? fence[1]! : text;
}

/**
 * Approximate cost in USD given Claude Haiku 4.5 list pricing
 * ($0.80/MTok in, $4/MTok out as of 2026). For Sonnet ($3/$15) the
 * factor's higher — caller should override `monthlyBudgetUsd` if
 * choosing a more expensive model.
 */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
	const sonnet = model.includes('sonnet');
	const inputPerM = sonnet ? 3.0 : 0.8;
	const outputPerM = sonnet ? 15.0 : 4.0;
	return (inputTokens * inputPerM + outputTokens * outputPerM) / 1_000_000;
}

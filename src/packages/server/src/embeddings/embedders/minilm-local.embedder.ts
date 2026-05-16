import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Embedder } from '../../providers/provider.interface.js';
import { ProviderEventsService } from '../../providers/provider-events.service.js';
import { ProviderRegistry } from '../../providers/provider-registry.service.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_DIM = 384;

/**
 * `Xenova/all-MiniLM-L6-v2` — local CPU embedding pipeline via
 * `@huggingface/transformers`. ~80 MB ONNX model, downloaded to
 * `data/models/` on first use. Produces 384-dim L2-normalised
 * Float32Array vectors.
 *
 * Always "configured" — no API key — but `isConfigured()` returns
 * false until the model has been loaded the first time, so the UI
 * can show "Loading model…" status. The pipeline init is lazy:
 * we don't block startup on the download.
 */
@Injectable()
export class MiniLMLocalEmbedder implements Embedder, OnModuleInit {
	readonly id = 'minilm';
	readonly displayName = 'MiniLM (local)';
	readonly description =
		'Local CPU plot embedding via Xenova/all-MiniLM-L6-v2 (transformers.js). Free, ~80 MB model, no API call.';
	readonly capabilities = new Set(['embed'] as const);
	readonly auth = 'none' as const;
	readonly configFields = [];
	readonly rateLimit = {
		perSecond: 100, // CPU-bound; effectively unlimited.
	};
	readonly model = MODEL_ID;
	readonly dim = MODEL_DIM;

	private readonly logger = new Logger('MiniLMLocalEmbedder');
	private pipeline: any = null;
	private loadingPromise: Promise<any> | null = null;

	constructor(
		private readonly registry: ProviderRegistry,
		private readonly events: ProviderEventsService,
	) {}

	onModuleInit(): void {
		this.registry.register(this);
	}

	isConfigured(): boolean {
		return this.pipeline != null;
	}

	async healthCheck() {
		try {
			await this.ensurePipeline();
			const sample = await this.embed(['probe']);
			const ok = sample.length === 1 && sample[0]!.length === this.dim;
			return {
				ok,
				detail: ok ? `Model loaded, dim=${this.dim}` : 'Unexpected output shape',
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

	async embed(texts: string[]): Promise<Float32Array[]> {
		if (texts.length === 0) return [];
		const pipe = await this.ensurePipeline();
		const started = Date.now();
		const out: Float32Array[] = [];
		for (const text of texts) {
			const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 2000);
			if (cleaned.length === 0) {
				out.push(new Float32Array(this.dim));
				continue;
			}
			const result = await pipe(cleaned, { pooling: 'mean', normalize: true });
			out.push(new Float32Array(result.data as Float32Array));
		}
		this.events.record({
			providerId: this.id,
			type: 'call',
			statusCode: 200,
			durationMs: Date.now() - started,
		});
		return out;
	}

	/** Force-load the model. Called by admin "embed library" trigger. */
	async warmup(): Promise<void> {
		await this.ensurePipeline();
	}

	private async ensurePipeline(): Promise<any> {
		if (this.pipeline) return this.pipeline;
		if (this.loadingPromise) return this.loadingPromise;
		this.loadingPromise = this.loadPipeline();
		try {
			this.pipeline = await this.loadingPromise;
			this.logger.log(`MiniLM model loaded (${MODEL_ID})`);
			return this.pipeline;
		} finally {
			this.loadingPromise = null;
		}
	}

	private async loadPipeline(): Promise<any> {
		// Dynamic import keeps transformers.js out of the cold-start
		// path for installs that never opt into embeddings.
		const { pipeline } = await import('@huggingface/transformers');
		const extractor = await pipeline('feature-extraction', MODEL_ID);
		return extractor;
	}
}

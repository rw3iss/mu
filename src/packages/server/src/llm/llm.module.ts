import { Global, Module } from '@nestjs/common';
import { AnthropicClient } from './anthropic.client.js';

/**
 * LLM source module. Currently registers the Anthropic client; future
 * additions (OpenAI, Ollama, etc.) drop in here as sibling classes
 * implementing the same `LLMClient` interface — no changes elsewhere
 * in the codebase needed.
 *
 * Marked `@Global()` so the recommendations module can inject the
 * Anthropic client (for re-rank) without a tight module dependency.
 */
@Global()
@Module({
	providers: [AnthropicClient],
	exports: [AnthropicClient],
})
export class LlmModule {}

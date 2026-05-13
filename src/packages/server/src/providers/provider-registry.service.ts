import { Injectable, Logger } from '@nestjs/common';
import type { Capability, Provider } from './provider.interface.js';

/**
 * Central catalogue of providers. NestJS modules call `register()` in
 * their `onModuleInit` hook; the rest of the app calls `list()` /
 * `get()` to find providers by capability without ever touching a
 * concrete class.
 *
 * Two important properties:
 *
 *   - `list(cap)` filters by capability set membership.
 *   - `configured(cap)` further filters to providers whose
 *     `isConfigured()` returns true — what the orchestrator should
 *     actually invoke.
 *
 * Duplicate registration (same `id`) replaces the prior entry and
 * logs a warning — useful in tests, surprising in prod, so we log it.
 */
@Injectable()
export class ProviderRegistry {
	private readonly logger = new Logger('ProviderRegistry');
	private readonly providers = new Map<string, Provider>();

	register(provider: Provider): void {
		if (this.providers.has(provider.id)) {
			this.logger.warn(`Replacing existing provider registration: ${provider.id}`);
		}
		this.providers.set(provider.id, provider);
		this.logger.log(
			`Provider registered: ${provider.id} [${Array.from(provider.capabilities).join(', ')}]`,
		);
	}

	unregister(id: string): boolean {
		return this.providers.delete(id);
	}

	get<T extends Provider = Provider>(id: string): T | null {
		return (this.providers.get(id) as T | undefined) ?? null;
	}

	has(id: string): boolean {
		return this.providers.has(id);
	}

	/** All providers, optionally filtered to a capability. */
	list(capability?: Capability): Provider[] {
		const all = Array.from(this.providers.values());
		if (!capability) return all;
		return all.filter((p) => p.capabilities.has(capability));
	}

	/** Only providers whose `isConfigured()` returns true. */
	configured(capability?: Capability): Provider[] {
		return this.list(capability).filter((p) => p.isConfigured());
	}

	size(): number {
		return this.providers.size;
	}

	clear(): void {
		this.providers.clear();
	}
}

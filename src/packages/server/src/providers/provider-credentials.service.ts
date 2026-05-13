import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { providerCredentials } from '../database/schema/index.js';
import type { ConfigFieldSpec } from './provider.interface.js';

/**
 * Owns the `provider_credentials` table. Secrets never leave this
 * service in cleartext except when a provider's outbound HTTP call
 * requests them — admin API responses always come back masked.
 *
 * v1 is cleartext-at-rest (server is private, behind admin auth).
 * v2 will encrypt at rest under `MU_SECRETS_KEY`; the `encrypted`
 * column is the migration switch and no callsite outside this file
 * needs to change.
 */
@Injectable()
export class ProviderCredentialsService {
	private readonly logger = new Logger('ProviderCredentialsService');

	constructor(private readonly database: DatabaseService) {}

	/** Returns the raw config object for the given provider, or null. */
	getRaw(providerId: string): Record<string, unknown> | null {
		const row = this.database.db
			.select()
			.from(providerCredentials)
			.where(eq(providerCredentials.providerId, providerId))
			.get();
		if (!row || !row.enabled) return null;
		try {
			return JSON.parse(row.config) as Record<string, unknown>;
		} catch (err: any) {
			this.logger.warn(`Failed to parse config for ${providerId}: ${err.message}`);
			return null;
		}
	}

	/**
	 * Returns the config with `secret`-type fields masked, suitable
	 * for sending to admin clients. `fields` is the provider's own
	 * configFields spec — we don't try to guess what's secret.
	 */
	getMasked(
		providerId: string,
		fields: readonly ConfigFieldSpec[],
	): Record<string, unknown> | null {
		const raw = this.getRaw(providerId);
		if (!raw) return null;
		const masked: Record<string, unknown> = {};
		for (const f of fields) {
			const v = raw[f.key];
			if (v === undefined || v === null) {
				masked[f.key] = null;
				continue;
			}
			if (f.type === 'secret' && typeof v === 'string') {
				masked[f.key] = maskSecret(v);
			} else {
				masked[f.key] = v;
			}
		}
		return masked;
	}

	/** True if a credential row exists for this provider AND it's enabled. */
	isConfigured(providerId: string): boolean {
		const row = this.database.db
			.select({ enabled: providerCredentials.enabled })
			.from(providerCredentials)
			.where(eq(providerCredentials.providerId, providerId))
			.get();
		return !!row && !!row.enabled;
	}

	upsert(
		providerId: string,
		config: Record<string, unknown>,
		fields: readonly ConfigFieldSpec[],
	): void {
		// Drop unknown keys (defensive) and preserve existing secret
		// values when the inbound value is the masked form.
		const existing = this.getRaw(providerId) ?? {};
		const sanitised: Record<string, unknown> = {};
		for (const f of fields) {
			const incoming = config[f.key];
			if (
				f.type === 'secret' &&
				typeof incoming === 'string' &&
				isMaskedSecret(incoming) &&
				existing[f.key] !== undefined
			) {
				sanitised[f.key] = existing[f.key];
			} else if (incoming !== undefined) {
				sanitised[f.key] = incoming;
			} else if (existing[f.key] !== undefined) {
				sanitised[f.key] = existing[f.key];
			}
		}

		const now = nowISO();
		const existingRow = this.database.db
			.select({ providerId: providerCredentials.providerId })
			.from(providerCredentials)
			.where(eq(providerCredentials.providerId, providerId))
			.get();

		if (existingRow) {
			this.database.db
				.update(providerCredentials)
				.set({ config: JSON.stringify(sanitised), updatedAt: now })
				.where(eq(providerCredentials.providerId, providerId))
				.run();
		} else {
			this.database.db
				.insert(providerCredentials)
				.values({
					providerId,
					config: JSON.stringify(sanitised),
					enabled: true,
					encrypted: false,
					addedAt: now,
					updatedAt: now,
				})
				.run();
		}
		this.logger.log(`Credentials saved for ${providerId}`);
	}

	setEnabled(providerId: string, enabled: boolean): boolean {
		const row = this.database.db
			.update(providerCredentials)
			.set({ enabled, updatedAt: nowISO() })
			.where(eq(providerCredentials.providerId, providerId))
			.run();
		return row.changes > 0;
	}

	delete(providerId: string): boolean {
		const row = this.database.db
			.delete(providerCredentials)
			.where(eq(providerCredentials.providerId, providerId))
			.run();
		return row.changes > 0;
	}
}

/**
 * `sk_xxxx....abcd` — keep first 4 + last 4 chars when long enough,
 * otherwise blanket-mask. Reused by ProvidersController for any
 * outbound config view.
 */
export function maskSecret(value: string): string {
	if (value.length <= 8) return '••••••••';
	return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/** Recognises the output of `maskSecret` so re-saves don't overwrite real secrets. */
export function isMaskedSecret(value: string): boolean {
	return value.includes('••••');
}

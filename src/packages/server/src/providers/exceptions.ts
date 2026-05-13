/**
 * Provider-platform exceptions. The job runner / orchestrator
 * catches these to drive requeueing, error logging, and admin UI
 * state — never let one of these surface as an opaque 500.
 */

export class RateLimitExceeded extends Error {
	readonly name = 'RateLimitExceeded';
	constructor(
		readonly providerId: string,
		readonly window: 'second' | 'minute' | 'day' | 'month',
		/** Milliseconds to wait before retrying. */
		readonly retryAfterMs: number,
	) {
		super(`Rate limit hit on provider "${providerId}" (${window} window).`);
	}
}

export class BudgetExhausted extends Error {
	readonly name = 'BudgetExhausted';
	constructor(
		readonly providerId: string,
		readonly spent: number,
		readonly ceiling: number,
	) {
		super(
			`Provider "${providerId}" is over its monthly budget ($${spent.toFixed(
				4,
			)} / $${ceiling.toFixed(2)}).`,
		);
	}
}

export class ProviderNotConfigured extends Error {
	readonly name = 'ProviderNotConfigured';
	constructor(readonly providerId: string) {
		super(`Provider "${providerId}" is not configured.`);
	}
}

export class ProviderCooledDown extends Error {
	readonly name = 'ProviderCooledDown';
	constructor(
		readonly providerId: string,
		readonly until: string,
	) {
		super(`Provider "${providerId}" is cooled down until ${until}.`);
	}
}

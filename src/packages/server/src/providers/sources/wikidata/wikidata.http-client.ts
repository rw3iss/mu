import { Logger } from '@nestjs/common';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const DEFAULT_UA = 'mu/1.0 (https://github.com/rw3iss/mu)';

/**
 * Thin HTTP client for Wikidata's SPARQL endpoint.
 *
 * SPARQL queries return JSON-shaped bindings:
 *   { head: { vars: [...] }, results: { bindings: [{ var: { value, type } }] } }
 *
 * We unwrap that to a flat list of records ({ varName → value }) so
 * the provider doesn't have to care about SPARQL plumbing.
 */
export class WikidataHttpClient {
	private readonly logger = new Logger('WikidataHttpClient');
	private readonly userAgent: string;

	constructor(userAgent?: string) {
		this.userAgent = userAgent && userAgent.trim() !== '' ? userAgent : DEFAULT_UA;
	}

	async query<T extends Record<string, string>>(sparql: string): Promise<T[]> {
		const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`;
		const res = await fetch(url, {
			headers: {
				Accept: 'application/sparql-results+json',
				'User-Agent': this.userAgent,
			},
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			this.logger.warn(`Wikidata SPARQL ${res.status}: ${body.slice(0, 200)}`);
			throw new Error(`Wikidata SPARQL ${res.status}`);
		}
		const json = (await res.json()) as {
			results?: { bindings?: Record<string, { value: string }>[] };
		};
		const bindings = json?.results?.bindings ?? [];
		// Flatten each binding to a string-only record. Callers cast/parse
		// numerics themselves — the field types are heterogeneous.
		return bindings.map((b) => {
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(b)) {
				out[k] = v.value;
			}
			return out as T;
		});
	}
}

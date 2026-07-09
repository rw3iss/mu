/**
 * Per-source credential / config shape for Wikidata.
 *
 * Wikidata's SPARQL endpoint is open and requires no key — but a
 * descriptive User-Agent header is required by their etiquette
 * policy. We let admins set it via the standard credential flow
 * so they can identify their instance if Wikidata staff need to
 * contact them about abusive queries.
 */
export interface WikidataCredentials {
	/**
	 * User-Agent header. Defaults to "mu/1.0 (https://github.com/rw3iss/mu)"
	 * when unset — accepted by Wikidata but a self-identifying string
	 * is encouraged for any deployment running real-time queries.
	 */
	userAgent?: string;
}

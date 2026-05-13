/**
 * Thin compat shim — keep existing detectors importing `normaliseTitle`
 * and `titleTokens` while the real logic lives in `title-sanitiser.ts`.
 *
 * Originally these lived here in isolation; they now route through the
 * unified sanitiser so the admin "Sanitize Title Names" action and the
 * grouping pipeline can't drift apart.
 */
export { sanitiseRawTitle as normaliseTitle, titleTokens } from './title-sanitiser.js';

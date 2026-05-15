import type { Logger } from '@nestjs/common';
import type {
	CandidateEntityType,
	MatchCandidatesRepository,
} from '../match-candidates.repository.js';
import {
	DEFAULT_MATCHER_CONFIG,
	findBestMatch,
	type MatchCandidate,
	type MatchQuery,
	type MatcherConfig,
	type ScoredCandidate,
} from './matcher.js';

/**
 * One of the three terminal states the resolver lands in:
 *   - `applied`  → a confident winner was picked + applied by the caller.
 *   - `ambiguous` → top candidates were persisted for user review.
 *   - `no-match` → nothing was confident enough; existing candidates cleared.
 */
export type ResolveOutcome<TResult> =
	| { kind: 'applied'; winner: ScoredCandidate; result: TResult | null }
	| { kind: 'ambiguous' }
	| { kind: 'no-match' };

export interface ResolveMatchOptions<TCand extends MatchCandidate, TResult> {
	entityType: CandidateEntityType;
	entityId: string;
	/** Human-friendly label used in log lines (e.g. movie title, group name). */
	entityLabel: string;
	candidates: TCand[];
	query: MatchQuery;
	matcher?: MatcherConfig;
	repository: MatchCandidatesRepository;
	logger: Logger;
	/** Called when the matcher picks a confident winner. */
	onConfident: (winner: TCand, scored: ScoredCandidate<TCand>) => Promise<TResult | null>;
	/** Optional hook that fires for ambiguous/no-match results — used
	 *  e.g. by the movie path to emit a WebSocket event so the UI can
	 *  show the freshly-persisted candidate list immediately. */
	onAmbiguous?: () => void;
	/** Pulled off each candidate when persisting the dropdown rows. */
	overviewOf?: (candidate: TCand) => string | null | undefined;
}

/**
 * Shared three-way decision tree for the matcher's output. Both the
 * movie path (`MetadataService.fetchForMovie`) and the group path
 * (`GroupMetadataService.fetchForGroup`) flow through this so the
 * persistence, logging, and clearing semantics stay in lock-step.
 *
 * The caller supplies:
 *   - the candidate list (already provider-specific)
 *   - the query (title, year, optional duration)
 *   - an `onConfident` callback that performs the actual write
 *
 * The resolver handles: scoring → branching → persistence/clearing of
 * `metadata_match_candidates`, plus uniform log lines. Callers stay
 * thin and provider-agnostic.
 */
export async function resolveMatch<TCand extends MatchCandidate, TResult>(
	opts: ResolveMatchOptions<TCand, TResult>,
): Promise<ResolveOutcome<TResult>> {
	const {
		entityType,
		entityId,
		entityLabel,
		candidates,
		query,
		matcher = DEFAULT_MATCHER_CONFIG,
		repository,
		logger,
		onConfident,
		onAmbiguous,
		overviewOf,
	} = opts;

	if (candidates.length === 0) {
		repository.clear(entityType, entityId);
		logger.debug(`No candidates for ${entityType} "${entityLabel}"`);
		return { kind: 'no-match' };
	}

	const match = findBestMatch(query, candidates, matcher);

	if (match.noMatch || !match.best) {
		repository.clear(entityType, entityId);
		logger.warn(
			`No confident match for ${entityType} "${entityLabel}" — best confidence ${
				match.best?.confidence.toFixed(2) ?? 'n/a'
			}`,
		);
		return { kind: 'no-match' };
	}

	if (match.ambiguous) {
		repository.replaceFromRanked(entityType, entityId, match.ranked, { overviewOf });
		logger.log(
			`Ambiguous match for ${entityType} "${entityLabel}" — saved candidates (top confidence: ${match.best.confidence.toFixed(2)})`,
		);
		onAmbiguous?.();
		return { kind: 'ambiguous' };
	}

	// Confident — clear any stale candidates and hand off.
	repository.clear(entityType, entityId);
	const winning = match.best.candidate;
	const result = await onConfident(winning, match.best as ScoredCandidate<TCand>);
	logger.log(
		`Matched ${entityType} "${entityLabel}" → ${winning.title}${
			winning.year ? ` (${winning.year})` : ''
		} via ${winning.provider} confidence=${match.best.confidence.toFixed(2)}`,
	);
	return { kind: 'applied', winner: match.best, result };
}

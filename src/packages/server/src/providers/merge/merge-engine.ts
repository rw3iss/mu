import { Injectable } from '@nestjs/common';
import { buildRuleMap, DEFAULT_MERGE_RULES, type FieldRule } from './merge-rules.js';
import type {
	CanonicalField,
	CanonicalRecord,
	FieldChange,
	MergeResult,
	ProvenanceMap,
	SourceContribution,
} from './merge-types.js';
import { USER_SOURCE } from './merge-types.js';

/**
 * Generic, declarative metadata merge engine.
 *
 * Inputs:
 *   - An existing record + its provenance map (what we know now,
 *     and which source set each field).
 *   - A list of incoming SourceContributions (per-source normalised
 *     payloads).
 *
 * Output:
 *   - A merged record + updated provenance + a per-field diff log.
 *
 * Key properties:
 *   - **Idempotent.** Replaying the same contributions over the same
 *     starting record yields the same output. Tests rely on this.
 *   - **Additive.** A source only overwrites a field when its
 *     precedence beats the recorded provenance source's precedence.
 *     "Lower" sources can still set previously-empty fields.
 *   - **User-sentinel.** The literal source 'user' always beats any
 *     provider. Used when an admin manually edits a field through
 *     the UI.
 *   - **Strategy-driven.** Per-field rules pick the combine strategy
 *     (`take-best`, `merge-arrays`, `numeric-max`, `numeric-avg`).
 *
 * SOLID notes:
 *   - SRP: this class ONLY merges. It does not fetch, persist, or
 *     route. The DB layer reads/writes the result; providers produce
 *     contributions; the matcher feeds contributions in here.
 *   - OCP: open for extension via new FieldRule entries / new
 *     MergeStrategy literals (add a branch in `combine`). Closed for
 *     modification of existing per-field behavior.
 *   - DIP: callers depend on this Injectable, not concrete impls of
 *     contributions or rules.
 */
@Injectable()
export class MergeEngine {
	private readonly ruleMap: Map<CanonicalField, FieldRule>;

	/**
	 * NestJS-friendly parameterless constructor. The default rule set
	 * is loaded at construction time. Tests that need a different
	 * rule set call {@link MergeEngine.withRules} (factory) instead
	 * of new-ing this class directly.
	 */
	constructor() {
		this.ruleMap = buildRuleMap(DEFAULT_MERGE_RULES);
	}

	/** Factory for tests / custom-rule scenarios. Not registered in DI. */
	static withRules(rules: FieldRule[]): MergeEngine {
		const instance = Object.create(MergeEngine.prototype) as MergeEngine;
		(instance as unknown as { ruleMap: Map<CanonicalField, FieldRule> }).ruleMap =
			buildRuleMap(rules);
		return instance;
	}

	apply(
		existing: CanonicalRecord,
		existingProvenance: ProvenanceMap,
		contributions: SourceContribution[],
	): MergeResult {
		// Sort contributions deterministically so the diff log is stable
		// across runs. Ordering by source then fetchedAt keeps replays
		// reproducible (and lets numeric-max / merge-arrays accumulate
		// without depending on caller insertion order).
		const ordered = [...contributions].sort((a, b) => {
			if (a.source !== b.source) return a.source < b.source ? -1 : 1;
			return (a.fetchedAt ?? '').localeCompare(b.fetchedAt ?? '');
		});

		const merged: CanonicalRecord = { ...existing };
		const provenance: ProvenanceMap = { ...existingProvenance };
		const diff: FieldChange[] = [];

		// Walk each known field rule and let every contribution apply.
		for (const [field, rule] of this.ruleMap.entries()) {
			for (const contrib of ordered) {
				const incomingValue = contrib.fields[field];
				if (incomingValue === undefined || incomingValue === null) continue;
				if (this.isEmptyValue(incomingValue, rule.strategy)) continue;

				const previousValue = merged[field];
				const previousSource = provenance[field] ?? null;
				const result = this.combine(
					rule,
					previousValue,
					previousSource,
					incomingValue,
					contrib.source,
				);
				if (result === null) continue; // no-op (lower precedence / user override)
				if (result.value !== previousValue || result.sourceUsed !== previousSource) {
					merged[field] = result.value;
					provenance[field] = result.sourceUsed;
					diff.push({
						field,
						previousValue,
						previousSource,
						newValue: result.value,
						newSource: result.sourceUsed,
						reason: result.reason,
					});
				}
			}
		}

		return { merged, provenance, diff };
	}

	/**
	 * The user sentinel: short-circuits any provider trying to
	 * overwrite a user-set field. Mark a field as user-owned by
	 * writing the constant USER_SOURCE into its provenance entry.
	 */
	private isUserOwned(provenanceSource: string | null): boolean {
		return provenanceSource === USER_SOURCE;
	}

	private precedenceOf(rule: FieldRule, source: string): number {
		return rule.precedence[source] ?? 0;
	}

	private isEmptyValue(value: unknown, strategy: FieldRule['strategy']): boolean {
		if (value === null || value === undefined) return true;
		if (strategy === 'merge-arrays') {
			if (Array.isArray(value)) return value.length === 0;
			if (typeof value === 'string') return value.trim() === '';
		}
		if (strategy === 'take-best' && typeof value === 'string') return value.trim() === '';
		return false;
	}

	/**
	 * Per-strategy combine logic. Returns null when the incoming
	 * value can't or shouldn't overwrite the existing — caller skips
	 * the diff entry.
	 */
	private combine(
		rule: FieldRule,
		previousValue: unknown,
		previousSource: string | null,
		incomingValue: unknown,
		incomingSource: string,
	): { value: unknown; sourceUsed: string; reason: FieldChange['reason'] } | null {
		// User-owned fields are immutable except by another user write.
		if (this.isUserOwned(previousSource) && incomingSource !== USER_SOURCE) {
			return null;
		}

		// User writes always succeed.
		if (incomingSource === USER_SOURCE) {
			return { value: incomingValue, sourceUsed: USER_SOURCE, reason: 'user-override' };
		}

		const incomingPrec = this.precedenceOf(rule, incomingSource);
		const previousPrec = previousSource ? this.precedenceOf(rule, previousSource) : -1;
		const previousIsEmpty =
			previousValue === undefined ||
			previousValue === null ||
			this.isEmptyValue(previousValue, rule.strategy);

		// First-set: nothing there yet → take it.
		if (previousIsEmpty) {
			return {
				value: this.normaliseForStorage(rule.strategy, incomingValue, undefined),
				sourceUsed: incomingSource,
				reason: 'first-set',
			};
		}

		switch (rule.strategy) {
			case 'take-best': {
				if (incomingPrec > previousPrec) {
					return {
						value: incomingValue,
						sourceUsed: incomingSource,
						reason: 'higher-precedence',
					};
				}
				return null;
			}
			case 'numeric-max': {
				const prev = toNumber(previousValue);
				const inc = toNumber(incomingValue);
				if (inc !== null && (prev === null || inc > prev)) {
					return {
						value: inc,
						sourceUsed: incomingPrec >= previousPrec ? incomingSource : previousSource!,
						reason: 'higher-precedence',
					};
				}
				return null;
			}
			case 'numeric-avg': {
				// Provenance for avg defaults to whichever source has the
				// higher precedence (caller can read raw payloads if they
				// need to know every contributor).
				const prev = toNumber(previousValue);
				const inc = toNumber(incomingValue);
				if (prev === null && inc !== null) {
					return { value: inc, sourceUsed: incomingSource, reason: 'first-set' };
				}
				if (prev !== null && inc !== null) {
					const avg = (prev + inc) / 2;
					return {
						value: avg,
						sourceUsed: incomingPrec >= previousPrec ? incomingSource : previousSource!,
						reason: 'higher-precedence',
					};
				}
				return null;
			}
			case 'merge-arrays': {
				const merged = mergeArrayValues(previousValue, incomingValue);
				if (sameArray(previousValue, merged)) return null;
				return {
					value: merged,
					// merge-arrays records the higher-precedence source for
					// transparency; the actual values come from both.
					sourceUsed: incomingPrec >= previousPrec ? incomingSource : previousSource!,
					reason: 'merged-collection',
				};
			}
		}
	}

	private normaliseForStorage(
		strategy: FieldRule['strategy'],
		value: unknown,
		_existing: unknown,
	): unknown {
		if (strategy === 'merge-arrays') return mergeArrayValues(undefined, value);
		return value;
	}
}

function toNumber(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string') {
		const n = Number(v.replace(/,/g, ''));
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** Union two array-or-string values into an array, deduped case-insensitively. */
function mergeArrayValues(a: unknown, b: unknown): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const x of [a, b]) {
		for (const item of valueToList(x)) {
			const key = item.toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				out.push(item);
			}
		}
	}
	return out;
}

function valueToList(v: unknown): string[] {
	if (Array.isArray(v)) {
		return v.map((x) => String(x).trim()).filter(Boolean);
	}
	if (typeof v === 'string' && v.trim() !== '') {
		// Accept either a JSON array, a comma-separated list, or a single value.
		try {
			const parsed = JSON.parse(v);
			if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
		} catch {
			// not JSON
		}
		return v
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return [];
}

function sameArray(prev: unknown, next: string[]): boolean {
	const prevList = valueToList(prev);
	if (prevList.length !== next.length) return false;
	const a = new Set(prevList.map((x) => x.toLowerCase()));
	for (const x of next) if (!a.has(x.toLowerCase())) return false;
	return true;
}

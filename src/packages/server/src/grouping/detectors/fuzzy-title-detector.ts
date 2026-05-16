import { Injectable } from '@nestjs/common';
import { DEFAULT_THRESHOLDS, titleSimilarity } from '../confidence.js';
import { normaliseTitle } from '../title-normaliser.js';
import { DetectionInput, DetectionResult, Detector } from './types.js';

/**
 * Last-resort detector: no SExx, no clear folder layout, no multi-file
 * siblings. Just fuzzy-match the movie's title against every existing
 * parent group. If a match scores ≥0.78 we treat it as belonging to
 * that parent (no season info; ordinals null).
 *
 * Confidence ranges from 0.55 to 0.85 depending on similarity strength.
 * Almost everything here lands in "unsure" — the user confirms.
 */
@Injectable()
export class FuzzyTitleDetector implements Detector {
	priority = 50;
	name = 'fuzzy-title';

	detect(input: DetectionInput): DetectionResult | null {
		if (input.existingParents.length === 0) return null;
		const normalised = normaliseTitle(input.movieTitle);
		if (!normalised) return null;

		let bestParent = input.existingParents[0]!;
		let bestSim = 0;
		const alternatives: Array<{ parentGroupId: string; confidence: number }> = [];
		for (const p of input.existingParents) {
			const sim = titleSimilarity(normalised, p.name);
			if (sim > bestSim) {
				if (bestSim >= DEFAULT_THRESHOLDS.fuzzyMatchThreshold) {
					alternatives.push({ parentGroupId: bestParent.id, confidence: bestSim });
				}
				bestParent = p;
				bestSim = sim;
			} else if (sim >= DEFAULT_THRESHOLDS.fuzzyMatchThreshold) {
				alternatives.push({ parentGroupId: p.id, confidence: sim });
			}
		}

		if (bestSim < DEFAULT_THRESHOLDS.fuzzyMatchThreshold) return null;

		// Confidence: scale the similarity 0.78..1.0 into 0.55..0.85 so
		// even great fuzzy matches still need user confirmation (since
		// the detector knows nothing else about season / episode).
		const confidence = 0.55 + ((bestSim - 0.78) / 0.22) * 0.3;

		return {
			parentName: bestParent.name,
			parentGroupId: bestParent.id,
			subgroupName: `${bestParent.name} - Unsorted`,
			ordinal: null,
			episodeOrdinal: null,
			confidence: Math.min(0.85, Math.max(0.55, confidence)),
			source: this.name as DetectionResult['source'],
			alternatives: alternatives.length ? alternatives : undefined,
			groupTypeHint: 'series',
		};
	}
}

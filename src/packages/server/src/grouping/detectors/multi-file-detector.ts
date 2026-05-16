import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { DEFAULT_THRESHOLDS, titleSimilarity } from '../confidence.js';
import { GENERIC_FOLDER_NAMES, sanitiseRawTitle } from '../title-sanitiser.js';
import { DetectionInput, DetectionResult, Detector } from './types.js';

/**
 * Multi-file folder heuristic: the file lives in a folder that contains
 * N≥3 other video files, none of which have SxxExx markers and the
 * folder isn't a "Season N"-shaped name. Likely a single-season /
 * collection / multi-part folder.
 *
 * Conservative: 0.65 confidence — almost always lands in "unsure" so
 * the user confirms.
 */
@Injectable()
export class MultiFileDetector implements Detector {
	priority = 40;
	name = 'multi-file';

	private readonly MIN_SIBLINGS = 3;
	private readonly VIDEO_EXTS = new Set([
		'.mkv',
		'.mp4',
		'.avi',
		'.mov',
		'.m4v',
		'.webm',
		'.wmv',
		'.flv',
		'.ts',
		'.mpg',
		'.mpeg',
	]);

	detect(input: DetectionInput): DetectionResult | null {
		const videoSiblings = input.siblingPaths.filter((p) =>
			this.VIDEO_EXTS.has(path.extname(p).toLowerCase()),
		);
		if (videoSiblings.length < this.MIN_SIBLINGS) return null;

		// Don't fire when the folder is clearly a season folder — the
		// folder-tree detector owns that case.
		const folder = path.basename(path.dirname(input.filePath));
		if (/^(?:season|series|s)[\s._-]?\d/i.test(folder)) return null;

		const normalised = sanitiseRawTitle(folder);
		if (!normalised) return null;

		// Never group on top-level library roots like "Movies" / "TV" /
		// "Shows" — that produces a 60+-member "Movies" pseudo-group
		// for every loose file in the user's library root.
		if (GENERIC_FOLDER_NAMES.has(normalised)) return null;
		// Also bail on a normalised one-token name that's too short to
		// be a real title (e.g. a single letter or digit folder).
		if (normalised.length < 3) return null;

		const folderName = titleCase(normalised);

		// Fuzzy match against existing parents.
		let parentGroupId: string | undefined;
		const alternatives: Array<{ parentGroupId: string; confidence: number }> = [];
		let bestMatch = 0;
		for (const p of input.existingParents) {
			const sim = titleSimilarity(normalised, p.name);
			if (sim >= DEFAULT_THRESHOLDS.fuzzyMatchThreshold) {
				if (sim > bestMatch) {
					if (parentGroupId) alternatives.push({ parentGroupId, confidence: bestMatch });
					parentGroupId = p.id;
					bestMatch = sim;
				} else {
					alternatives.push({ parentGroupId: p.id, confidence: sim });
				}
			}
		}

		// Episode = position in the alphabetised sibling list, 1-indexed.
		const sortedSiblings = [...videoSiblings].sort();
		const episode = sortedSiblings.indexOf(input.filePath) + 1;

		return {
			parentName: folderName,
			parentGroupId,
			subgroupName: folderName,
			ordinal: 1,
			episodeOrdinal: episode > 0 ? episode : null,
			confidence: 0.65,
			source: this.name as DetectionResult['source'],
			alternatives: alternatives.length ? alternatives : undefined,
			groupTypeHint: 'collection',
		};
	}
}

function titleCase(s: string): string {
	return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

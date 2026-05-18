import { Injectable } from '@nestjs/common';
import { DEFAULT_THRESHOLDS, titleSimilarity } from '../confidence.js';
import { normaliseTitle } from '../title-normaliser.js';
import { DetectionInput, DetectionResult, Detector } from './types.js';

/**
 * Gold-standard detector: filename SxxExx (or NxNN) pattern. The most
 * unambiguous signal we have — anything matching `s03e12`, `3x12`,
 * `S03.E12` etc. is almost certainly a TV episode.
 *
 *   Seinfeld.S03E12.1080p.mkv → {parent: "Seinfeld", season: 3, episode: 12}
 *   The Office 2x07 - Spaghetti.mkv → {parent: "The Office", season: 2, episode: 7}
 */
@Injectable()
export class SxxExxDetector implements Detector {
	priority = 10;
	name = 'sxxexx-filename';

	/** Conservative: separator before+after to avoid matching things like 'gs06e10' inside a word. */
	private readonly SE_PATTERN = /(?:^|[\s._-])s(\d{1,2})[\s._-]?e(\d{1,3})(?:[\s._-]|$|\.)/i;
	private readonly NX_PATTERN = /(?:^|[\s._-])(\d{1,2})x(\d{1,3})(?:[\s._-]|$|\.)/i;

	/** Tokens that suggest the captured show-name isn't a real title. */
	private readonly BLOCKLIST = new Set([
		'',
		'movie',
		'film',
		'the',
		'video',
		'episode',
		'show',
		'tv',
		'untitled',
		'sample',
	]);

	detect(input: DetectionInput): DetectionResult | null {
		const fname = stripExtension(input.fileName);

		// Try SxxExx first.
		let m = this.SE_PATTERN.exec(fname);
		let season: number | null = null;
		let episode: number | null = null;
		let cutAt = -1;
		if (m) {
			season = parseInt(m[1]!, 10);
			episode = parseInt(m[2]!, 10);
			cutAt = m.index;
		} else {
			m = this.NX_PATTERN.exec(fname);
			if (m) {
				season = parseInt(m[1]!, 10);
				episode = parseInt(m[2]!, 10);
				cutAt = m.index;
			}
		}
		if (m === null || season === null || episode === null) return null;

		// Text before the match is the show-name candidate.
		const rawShowName = fname.slice(0, cutAt);
		const normalised = normaliseTitle(rawShowName);
		if (this.BLOCKLIST.has(normalised)) {
			// Detector still fires but at low confidence — let fuzzy step decide.
			return this.makeResult('Unknown Show', season, episode, 0.55, input, normalised);
		}

		const showName = titleCase(normalised);
		const confidence = this.computeConfidence(rawShowName, normalised);
		return this.makeResult(showName, season, episode, confidence, input, normalised);
	}

	private computeConfidence(_raw: string, normalised: string): number {
		// Empty / very short / pure-number show names lower confidence.
		// `_raw` reserved for future heuristics that weigh punctuation
		// noise (e.g. heavy bracket clutter) against the cleaner
		// normalised form. Underscored to mark intentional non-use.
		if (!normalised) return 0.55;
		if (normalised.length <= 2) return 0.65;
		if (/^\d+$/.test(normalised)) return 0.6;
		// Clean SExx match with a normal show name → top confidence.
		return 0.95;
	}

	private makeResult(
		showName: string,
		season: number,
		episode: number,
		confidence: number,
		input: DetectionInput,
		normalisedShowName: string,
	): DetectionResult {
		// Fuzzy-match against existing parent groups.
		let parentGroupId: string | undefined;
		const alternatives: Array<{ parentGroupId: string; confidence: number }> = [];
		let bestMatch = 0;
		for (const p of input.existingParents) {
			const sim = titleSimilarity(normalisedShowName, p.name);
			if (sim >= DEFAULT_THRESHOLDS.fuzzyMatchThreshold) {
				if (sim > bestMatch) {
					if (parentGroupId) {
						alternatives.push({ parentGroupId, confidence: bestMatch });
					}
					parentGroupId = p.id;
					bestMatch = sim;
				} else {
					alternatives.push({ parentGroupId: p.id, confidence: sim });
				}
			}
		}

		const subgroupName = episode === 0 ? 'Specials' : `${showName} - Season ${season}`;
		const ordinal = episode === 0 ? 0 : season;

		return {
			parentName: showName,
			parentGroupId,
			subgroupName,
			ordinal,
			episodeOrdinal: episode,
			confidence,
			source: this.name as DetectionResult['source'],
			alternatives: alternatives.length ? alternatives : undefined,
			groupTypeHint: 'series',
		};
	}
}

function stripExtension(fname: string): string {
	return fname.replace(/\.[a-z0-9]{1,4}$/i, '');
}

/** Quick title-case for display. Caller already normalised, so words are lowercase. */
function titleCase(s: string): string {
	if (!s) return '';
	return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

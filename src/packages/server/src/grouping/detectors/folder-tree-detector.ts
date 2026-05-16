import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { DEFAULT_THRESHOLDS, titleSimilarity } from '../confidence.js';
import { GENERIC_FOLDER_NAMES, sanitiseRawTitle } from '../title-sanitiser.js';
import { DetectionInput, DetectionResult, Detector } from './types.js';

/**
 * Folder-tree detector. Picks up the common Plex-style layout:
 *   .../Show Name/Season 03/episode.mkv
 *   .../Show Name/S03/episode.mkv
 *   .../Show Name/Series 3/episode.mkv
 *
 * Lower priority than SxxExx because filename SExx is more authoritative
 * — folder layout can lie, the filename rarely does. But folder layout
 * still resolves cases where the filename is just "episode_07.mkv" with
 * no season marker.
 */
@Injectable()
export class FolderTreeDetector implements Detector {
	priority = 20;
	name = 'folder-tree';

	private readonly SEASON_DIR_PATTERNS = [
		/^season[\s._-]?(\d{1,3})$/i,
		/^s(\d{1,3})$/i,
		/^series[\s._-]?(\d{1,3})$/i,
	];

	detect(input: DetectionInput): DetectionResult | null {
		const parts = input.filePath.split(/[/\\]/);
		if (parts.length < 3) return null;

		// Walk from the file up. parts[-1] is the file; parts[-2] is its
		// immediate folder. We look for a season-style folder name in
		// parts[-2]; if found, parts[-3] is the show folder.
		const fileDir = parts[parts.length - 2] ?? '';
		const seasonNumber = this.parseSeasonFolder(fileDir);
		if (seasonNumber === null) return null;

		const showFolder = parts[parts.length - 3];
		if (!showFolder) return null;

		const rawShowName = showFolder;
		const normalised = sanitiseRawTitle(rawShowName);
		if (!normalised) return null;
		// Don't make a group whose parent is a generic library root.
		if (GENERIC_FOLDER_NAMES.has(normalised)) return null;
		const showName = titleCase(normalised);

		const episode = this.parseEpisodeFromFilename(input.fileName);

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

		const subgroupName =
			seasonNumber === 0 ? 'Specials' : `${showName} - Season ${seasonNumber}`;

		return {
			parentName: showName,
			parentGroupId,
			subgroupName,
			ordinal: seasonNumber,
			episodeOrdinal: episode,
			confidence: 0.85,
			source: this.name as DetectionResult['source'],
			alternatives: alternatives.length ? alternatives : undefined,
			groupTypeHint: 'series',
		};
	}

	private parseSeasonFolder(name: string): number | null {
		for (const pattern of this.SEASON_DIR_PATTERNS) {
			const m = pattern.exec(name);
			if (m) return parseInt(m[1]!, 10);
		}
		return null;
	}

	/** Best-effort: extract an episode number from the filename when SExx is absent. */
	private parseEpisodeFromFilename(fname: string): number | null {
		const base = path.basename(fname, path.extname(fname));
		// E12, e12 — standalone episode marker without season.
		const ePattern = /(?:^|[\s._-])e(\d{1,3})(?:[\s._-]|$)/i;
		const m = ePattern.exec(base);
		if (m) return parseInt(m[1]!, 10);
		// Trailing number: "episode 7", "ep 7", "07. Title", "Title - 07".
		const trailing = /(?:^|[\s._-])(?:ep(?:isode)?[\s._-]?)?(\d{1,3})(?:[\s._-]|$)/i.exec(base);
		if (trailing) {
			const n = parseInt(trailing[1]!, 10);
			if (n >= 1 && n <= 999) return n;
		}
		return null;
	}
}

function titleCase(s: string): string {
	return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

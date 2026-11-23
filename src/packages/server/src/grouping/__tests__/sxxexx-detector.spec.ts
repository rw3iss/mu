import { describe, expect, it } from 'vitest';
import { SxxExxDetector } from '../detectors/sxxexx-detector.js';

const det = new SxxExxDetector();
const input = (filePath: string, movieTitle: string) => ({
	movieId: 'm',
	movieTitle,
	filePath,
	fileName: filePath.split('/').pop()!,
	existingParents: [],
	siblingPaths: [],
});

describe('SxxExxDetector', () => {
	it('keeps the whole dotted show name', () => {
		const r = det.detect(input('/m/South.Park.S28E03.1080p.x265-ELiTE.mkv', 'x'));
		expect(r?.parentName).toBe('South Park');
		expect(r?.ordinal).toBe(28);
		expect(r?.episodeOrdinal).toBe(3);
	});

	it('falls back to the title, then the folder, when the file name lost the show', () => {
		expect(
			det.detect(input('/m/Movies/The - S01E08.mp4', 'The Hawk - S01E08'))?.parentName,
		).toBe('The Hawk');
		expect(
			det.detect(
				input(
					'/m/The.Hawk.S01.1080p.HEVC.x265-MeGusta/The - S01E02.mp4',
					'Unknown Show - S01E02',
				),
			)?.parentName,
		).toBe('The Hawk');
	});
});

import { describe, expect, it } from 'vitest';
import { buildTitleQuery } from '../query-preprocessor.js';

describe('buildTitleQuery', () => {
	it('classifies a Goliath-like episode as a tv-episode', () => {
		const q = buildTitleQuery({
			storedTitle: 'Goliath - S01E05',
			storedYear: null,
			fileName: 'Goliath.S01E05.Cover.Your.Ass.1080p.10bit.WEBRip.6CH.x265.HEVC-PSA.mkv',
			filePath: 'D:/Movies/Goliath.SEASON.01.S01.COMPLETE.1080p/Goliath.S01E05.mkv',
			durationSeconds: 3360,
		});
		expect(q.kind).toBe('tv-episode');
		if (q.kind !== 'tv-episode') return;
		expect(q.season).toBe(1);
		expect(q.episode).toBe(5);
		expect(q.showTitle).toMatch(/^goliath/);
	});

	it('keeps regular movies as movie queries with sanitised title + recovered year', () => {
		const q = buildTitleQuery({
			storedTitle: 'Inception',
			storedYear: null,
			fileName: 'Inception.2010.1080p.BluRay.x264.mkv',
			filePath: '/movies/Inception.2010.1080p.BluRay.x264.mkv',
			durationSeconds: 8880,
		});
		expect(q.kind).toBe('movie');
		if (q.kind !== 'movie') return;
		expect(q.year).toBe(2010);
		expect(q.durationMinutes).toBe(148);
		expect(q.sanitisedTitle).toBe('inception');
	});

	it('handles SxxEyy in the title even when filename is missing', () => {
		const q = buildTitleQuery({
			storedTitle: 'The Crown S04E03',
			storedYear: null,
			fileName: null,
			filePath: null,
			durationSeconds: null,
		});
		expect(q.kind).toBe('tv-episode');
		if (q.kind !== 'tv-episode') return;
		expect(q.season).toBe(4);
		expect(q.episode).toBe(3);
	});

	it('does NOT misclassify a movie whose name starts with "S<digits>" but is not SxxEyy', () => {
		// "S Darko" is a real movie. Plain "S01" alone without "E…" must
		// not trigger the tv-episode branch.
		const q = buildTitleQuery({
			storedTitle: 'S Darko',
			storedYear: 2009,
			fileName: 'S.Darko.2009.1080p.mkv',
			filePath: null,
			durationSeconds: 6300,
		});
		expect(q.kind).toBe('movie');
	});
});

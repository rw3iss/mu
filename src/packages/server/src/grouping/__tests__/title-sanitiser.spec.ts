import { describe, expect, it } from 'vitest';
import {
	buildPrettyTitle,
	displayTitle,
	isExtrasPath,
	parseEpisodeKey,
	sanitiseRawTitle,
	showNameFromPath,
} from '../title-sanitiser.js';

describe('title sanitiser', () => {
	it('keeps the last word of dotted names (only real extensions are stripped)', () => {
		expect(sanitiseRawTitle('South.Park')).toBe('south park');
		expect(sanitiseRawTitle('The.Last.of.Us')).toBe('last of us');
		expect(sanitiseRawTitle('Movie.Name.mkv')).toBe('movie name');
	});

	it('builds episode titles with the full show name and article', () => {
		expect(buildPrettyTitle('South.Park.S28E03.1080p.x265-ELiTE.mkv')).toBe(
			'South Park - S28E03',
		);
		expect(buildPrettyTitle('The.Hawk.S01E08.1080p.HEVC.x265-MeGusta.mkv')).toBe(
			'The Hawk - S01E08',
		);
		expect(buildPrettyTitle('The.Last.of.Us.S02E01.1080p.x265-ELiTE.mkv')).toBe(
			'The Last of Us - S02E01',
		);
		expect(
			buildPrettyTitle('Crazy4TV.com - Silicon.Valley.S04E05.720p.WEB-DL.x265.HEVC.mkv'),
		).toBe('Silicon Valley - S04E05');
	});

	it('displayTitle keeps the article and lowercases small words', () => {
		expect(displayTitle('The.Last.of.Us')).toBe('The Last of Us');
		expect(displayTitle('Halt.and.Catch.Fire')).toBe('Halt and Catch Fire');
	});

	it('gives two releases of one episode the same key', () => {
		const a = parseEpisodeKey('The.Hawk.S01E08.1080p.HEVC.x265-MeGusta.mkv');
		const b = parseEpisodeKey('The Hawk - S01E08.mp4');
		expect(a).toEqual({ show: 'hawk', season: 1, episode: 8 });
		expect(b).toEqual(a);
		expect(parseEpisodeKey('www.UIndex.org    -    Grimm S06E01 Fugitive 1080p.mkv')).toEqual({
			show: 'grimm',
			season: 6,
			episode: 1,
		});
		expect(parseEpisodeKey('The - S01E08.mp4')).toBeNull();
		expect(parseEpisodeKey('Inception.2010.1080p.mkv')).toBeNull();
	});

	it('detects bonus material by folder and name', () => {
		expect(isExtrasPath('/m/Akira (1988)/Featurettes/Trailer.mkv')).toBe(true);
		expect(isExtrasPath('/m/Anime/1c. Extras/Cowboy Bebop - Extra - NC OP.mp4')).toBe(true);
		expect(isExtrasPath('/m/Rumble/Sample,Screens/Rumble Sample.mkv')).toBe(true);
		expect(isExtrasPath('/m/G/Grumpy.Old.Men.1993.1080p.Sample.mp4')).toBe(true);
		expect(isExtrasPath('/m/Extras (2005) Season 1/Extras.S01E01.mkv')).toBe(false);
		expect(isExtrasPath('/m/Sampled.2020.1080p.mkv')).toBe(false);
		expect(isExtrasPath('/m/Silicon Valley/S04/Silicon.Valley.S04E05.mkv')).toBe(false);
	});
});

describe('buildPrettyTitle — episode pattern "Show - SxxEyy - Episode"', () => {
	it('fills a missing show from the hint and drops repeated markers', () => {
		const hint = { showHint: 'Band of Brothers' };
		expect(buildPrettyTitle('S01E02 Day of Days', hint)).toBe(
			'Band of Brothers - S01E02 - Day of Days',
		);
		expect(buildPrettyTitle('S01e02 Day of Days - S01E02', hint)).toBe(
			'Band of Brothers - S01E02 - Day of Days',
		);
		expect(buildPrettyTitle('S01e06 Bastogne S01e06 - S01E06', hint)).toBe(
			'Band of Brothers - S01E06 - Bastogne',
		);
		expect(buildPrettyTitle('S01E02 Day of Days')).toBe('S01E02 - Day of Days');
	});

	it('keeps the episode title from release names and is idempotent', () => {
		const t = buildPrettyTitle('The.Office.US.S01E02.Diversity.Day.1080p.BluRay.x265-RARBG');
		expect(t).toBe('The Office Us - S01E02 - Diversity Day');
		expect(buildPrettyTitle(t)).toBe(t);
		expect(buildPrettyTitle('South.Park.S28E03.1080p.WEB.h264-ETHEL')).toBe(
			'South Park - S28E03',
		);
		expect(buildPrettyTitle('Silicon Valley - S04E09 - Hooli-Con')).toBe(
			'Silicon Valley - S04E09 - Hooli-Con',
		);
	});
});

describe('showNameFromPath', () => {
	it('reads the show from release or season folders', () => {
		expect(showNameFromPath('/m/Movies/Band.Of.Brothers.S01.YG/S01E02 x.mkv')).toBe(
			'Band of Brothers',
		);
		expect(showNameFromPath('/m/Show Name/Season 1/x.mkv')).toBe('Show Name');
		expect(showNameFromPath('/m/Movies/x.mkv')).toBeNull();
	});
});

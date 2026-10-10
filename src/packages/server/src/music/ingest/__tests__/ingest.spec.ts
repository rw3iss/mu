import { describe, expect, it } from 'vitest';
import { albumArtistCredit, albumGroupKey } from '../grouping.js';
import { normKey, sortName, splitCredit, titleKey } from '../normalize.js';
import { parsePathFallback, type TrackTags } from '../tags.js';

function tags(over: Partial<TrackTags> = {}): TrackTags {
	return {
		title: 'Song', artistCredit: 'Artist', artists: ['Artist'], featured: [],
		albumArtistCredit: null, albumArtists: [], album: 'Album', discNo: 1, discTotal: null,
		trackNo: 1, trackTotal: null, year: 2000, originalYear: null, genres: [], compilation: false,
		isrc: null, mbid: { recording: null, release: null, releaseGroup: null, artists: [], albumArtists: [] },
		composer: [], replaygainTrack: null, replaygainAlbum: null, durationSeconds: 200,
		container: 'FLAC', codec: 'FLAC', bitrate: 900000, sampleRate: 44100, bitDepth: 16,
		channels: 2, lossless: true, picture: null, fromFilename: false, ...over,
	};
}

describe('normalize', () => {
	it('folds accents and punctuation', () => expect(normKey('Björk!')).toBe(normKey('bjork')));
	it('sorts leading articles', () => {
		expect(sortName('The Beatles')).toBe('Beatles, The');
		expect(sortName('Radiohead')).toBe('Radiohead');
	});
	it('splits only on feat., never on &', () => {
		expect(splitCredit('Simon & Garfunkel')).toEqual({ primary: ['Simon & Garfunkel'], featured: [] });
		expect(splitCredit('Daft Punk feat. Pharrell Williams & Nile Rodgers')).toEqual({
			primary: ['Daft Punk'], featured: ['Pharrell Williams', 'Nile Rodgers'],
		});
		expect(splitCredit('Calvin Harris (ft. Rihanna)').featured).toEqual(['Rihanna']);
	});
	it('ignores remaster noise in title keys', () =>
		expect(titleKey('Help! (Remastered 2009)')).toBe(titleKey('Help!')));
});

describe('path fallback', () => {
	it('parses Artist/Album (Year)/01 - Title', () => {
		expect(parsePathFallback('/m/Radiohead/OK Computer (1997)/02 - Paranoid Android.flac')).toEqual({
			title: 'Paranoid Android', artist: 'Radiohead', album: 'OK Computer', trackNo: 2, discNo: null, year: 1997,
		});
	});
	it('parses disc-track and Artist - Title files', () => {
		const r = parsePathFallback('/m/Various/Mix/1-03 Moby - Porcelain.mp3');
		expect(r).toMatchObject({ discNo: 1, trackNo: 3, artist: 'Moby', title: 'Porcelain' });
	});
});

describe('grouping', () => {
	it('prefers release-group mbid', () => {
		const t = tags({ mbid: { recording: null, release: null, releaseGroup: 'rg-1', artists: [], albumArtists: [] } });
		expect(albumGroupKey(t, '/a/b.flac', 'tags+folder')).toBe('rg:rg-1');
	});
	it('keeps compilation tracks together across track artists', () => {
		const a = tags({ compilation: true, artists: ['A'] });
		const b = tags({ compilation: true, artists: ['B'] });
		expect(albumGroupKey(a, '/c/x.flac', 'tags+folder')).toBe(albumGroupKey(b, '/c/y.flac', 'tags+folder'));
		expect(albumArtistCredit(a)).toEqual({ credit: 'Various Artists', names: [], various: true });
	});
	it('splits same-titled albums by folder', () => {
		const a = tags({ album: 'Greatest Hits', artists: ['X'] });
		expect(albumGroupKey(a, '/x/gh/1.flac', 'tags+folder')).not.toBe(albumGroupKey(a, '/y/gh/1.flac', 'tags+folder'));
	});
});

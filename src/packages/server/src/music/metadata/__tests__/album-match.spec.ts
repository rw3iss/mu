import { describe, expect, it } from 'vitest';
import type {
	MbReleaseDetail,
	MbReleaseHit,
} from '../../../providers/sources/musicbrainz/musicbrainz.client.js';
import {
	buildReleaseQuery,
	candidateList,
	durationScore,
	type LocalAlbum,
	mapAlbumType,
	pickConfident,
	rankReleases,
	scoreRelease,
	similarity,
	titleSimilarity,
	withDurations,
} from '../album-match.js';

const local: LocalAlbum = {
	title: 'OK Computer',
	artist: 'Radiohead',
	year: 1997,
	trackCount: 12,
	durations: [],
	various: false,
};

function hit(over: Partial<MbReleaseHit> & { rg?: string }): MbReleaseHit {
	return {
		id: over.id ?? 'r1',
		title: over.title ?? 'OK Computer',
		score: over.score ?? 100,
		date: over.date ?? '1997-05-21',
		status: over.status ?? 'Official',
		'track-count': over['track-count'] ?? 12,
		'artist-credit': over['artist-credit'] ?? [
			{ name: 'Radiohead', artist: { id: 'a1', name: 'Radiohead' } },
		],
		'release-group': { id: over.rg ?? 'rg1', 'primary-type': 'Album' },
	};
}

describe('similarity', () => {
	it('is 1 for equal and tolerant of word order / small typos', () => {
		expect(similarity('ok computer', 'ok computer')).toBe(1);
		expect(similarity('computer ok', 'ok computer')).toBe(1);
		expect(similarity('ok computr', 'ok computer')).toBeGreaterThan(0.85);
		expect(similarity('abbey road', 'ok computer')).toBeLessThan(0.4);
	});

	it('ignores remaster/deluxe noise in titles', () => {
		expect(titleSimilarity('OK Computer (Remastered 2009)', 'OK Computer')).toBe(1);
	});
});

describe('scoreRelease', () => {
	it('scores an exact match highly', () => {
		expect(scoreRelease(local, hit({}))).toBeGreaterThan(0.9);
	});

	it('penalises wrong artist even when everything else matches', () => {
		const wrong = hit({ 'artist-credit': [{ name: 'Coldplay' }] });
		expect(scoreRelease(local, wrong)).toBeLessThan(0.6);
	});

	it('prefers matching track count and year', () => {
		const exact = scoreRelease(local, hit({}));
		const deluxe = scoreRelease(local, hit({ 'track-count': 24, date: '2017-06-23' }));
		expect(exact).toBeGreaterThan(deluxe);
	});

	it('matches Various Artists compilations', () => {
		const comp: LocalAlbum = {
			...local,
			title: 'Now 1',
			artist: 'Various Artists',
			various: true,
		};
		const s = scoreRelease(
			comp,
			hit({ title: 'Now 1', 'artist-credit': [{ name: 'Various Artists' }] }),
		);
		expect(s).toBeGreaterThan(0.85);
	});
});

describe('pickConfident', () => {
	it('auto-picks a clear winner', () => {
		const ranked = rankReleases(local, [
			hit({ id: 'r1', rg: 'rg1' }),
			hit({ id: 'r2', rg: 'rg2', title: 'OK Computer OKNOTOK', 'track-count': 23 }),
		]);
		expect(pickConfident(ranked)?.hit.id).toBe('r1');
	});

	it('treats releases of the same group as one answer', () => {
		const ranked = rankReleases(local, [
			hit({ id: 'r1', rg: 'rg1' }),
			hit({ id: 'r2', rg: 'rg1', date: '1997-06-01' }),
		]);
		expect(pickConfident(ranked)?.hit['release-group']?.id).toBe('rg1');
	});

	it('refuses when two different groups tie', () => {
		const ranked = rankReleases(local, [
			hit({ id: 'r1', rg: 'rg1' }),
			hit({ id: 'r2', rg: 'rg2' }),
		]);
		expect(pickConfident(ranked)).toBeNull();
	});

	it('refuses below the threshold', () => {
		const ranked = rankReleases(local, [
			hit({ title: 'Kid A', 'track-count': 10, date: '2000' }),
		]);
		expect(pickConfident(ranked)).toBeNull();
	});
});

describe('durationScore', () => {
	const detail = (lengths: (number | null)[]): MbReleaseDetail => ({
		id: 'r1',
		title: 'x',
		media: [{ tracks: lengths.map((length) => ({ length })) }],
	});

	it('is 1 when every track is within 3s', () => {
		expect(durationScore([284, 383], detail([285_000, 381_500]))).toBe(1);
	});

	it('drops for big deltas and is null on count mismatch', () => {
		expect(durationScore([284, 383], detail([200_000, 100_000]))).toBe(0);
		expect(durationScore([284], detail([284_000, 1]))).toBeNull();
		expect(durationScore([], detail([1]))).toBeNull();
	});

	it('withDurations folds 20% weight', () => {
		expect(withDurations(0.8, null)).toBe(0.8);
		expect(withDurations(0.8, 1)).toBe(0.84);
	});
});

describe('helpers', () => {
	it('candidateList keeps the best release per group and drops noise', () => {
		const ranked = rankReleases(local, [
			hit({ id: 'r1', rg: 'rg1' }),
			hit({ id: 'r2', rg: 'rg1' }),
			hit({
				id: 'r3',
				rg: 'rg3',
				title: 'Something Else',
				'artist-credit': [{ name: 'Nobody' }],
			}),
		]);
		const list = candidateList(ranked);
		expect(list.map((c) => c.releaseMbid)).toEqual(['r1']);
		expect(list[0]?.releaseGroupMbid).toBe('rg1');
	});

	it('mapAlbumType', () => {
		expect(mapAlbumType('Album', ['Compilation'])).toBe('compilation');
		expect(mapAlbumType('Album', ['Live'])).toBe('live');
		expect(mapAlbumType('EP')).toBe('ep');
		expect(mapAlbumType('Broadcast')).toBe('other');
		expect(mapAlbumType(undefined)).toBe('album');
	});

	it('buildReleaseQuery escapes Lucene syntax and omits VA artist', () => {
		expect(buildReleaseQuery({ title: 'AC/DC: Live!', artist: 'AC/DC', various: false })).toBe(
			'release:"AC\\/DC\\: Live\\!" AND artist:"AC\\/DC"',
		);
		expect(
			buildReleaseQuery({ title: 'Now 1', artist: 'Various Artists', various: true }),
		).toBe('release:"Now 1"');
	});
});

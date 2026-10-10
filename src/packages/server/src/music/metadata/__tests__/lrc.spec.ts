import { describe, expect, it } from 'vitest';
import { pickLrclib } from '../clients.js';
import { isSyncedLrc, lrcToPlain, normalizeLrclib, parseLrc } from '../lrc.js';

const LRC = `[ar:Radiohead]
[ti:Airbag]
[00:12.50]In the next world war
[00:15.00][01:30.25]In a jackknifed juggernaut
[00:20.123]I am born again
[00:25.00]`;

describe('parseLrc', () => {
	it('parses stamps, repeats and sorts; skips metadata', () => {
		const lines = parseLrc(LRC);
		expect(lines.map((l) => l.time)).toEqual([12.5, 15, 20.123, 25, 90.25]);
		expect(lines[1]?.text).toBe('In a jackknifed juggernaut');
		expect(lines[4]?.text).toBe('In a jackknifed juggernaut');
		expect(lines[3]?.text).toBe('');
	});

	it('applies [offset:]', () => {
		const lines = parseLrc('[offset:+500]\n[00:10.00]a\n[00:11.00]b');
		expect(lines[0]?.time).toBe(9.5);
	});
});

describe('isSyncedLrc / lrcToPlain', () => {
	it('needs two timed text lines', () => {
		expect(isSyncedLrc(LRC)).toBe(true);
		expect(isSyncedLrc('[00:01.00]only one')).toBe(false);
		expect(isSyncedLrc('just words\nmore words')).toBe(false);
		expect(isSyncedLrc(null)).toBe(false);
	});

	it('strips stamps and metadata', () => {
		expect(lrcToPlain(LRC)).toBe(
			'In the next world war\nIn a jackknifed juggernaut\nI am born again',
		);
	});
});

describe('normalizeLrclib', () => {
	it('keeps synced and plain', () => {
		const n = normalizeLrclib({ plainLyrics: 'a\nb', syncedLyrics: LRC });
		expect(n.syncedLrc).toBe(LRC.trim());
		expect(n.plain).toBe('a\nb');
	});

	it('derives plain from synced and drops broken synced', () => {
		expect(normalizeLrclib({ syncedLyrics: LRC }).plain).toContain('I am born again');
		const broken = normalizeLrclib({ plainLyrics: 'x', syncedLyrics: 'not lrc' });
		expect(broken.syncedLrc).toBeNull();
		expect(broken.plain).toBe('x');
	});

	it('marks instrumentals with no text', () => {
		const n = normalizeLrclib({ instrumental: true, plainLyrics: null, syncedLyrics: null });
		expect(n).toEqual({ plain: null, syncedLrc: null, instrumental: true });
	});
});

describe('pickLrclib', () => {
	it('prefers synced hits within 3s of the duration', () => {
		const list = [
			{ duration: 400, syncedLyrics: LRC },
			{ duration: 284, plainLyrics: 'plain' },
			{ duration: 285, syncedLyrics: LRC, trackName: 'right' },
		];
		expect(pickLrclib(list, 284)?.trackName).toBe('right');
		expect(pickLrclib(list, 999)).toBeNull();
		expect(pickLrclib(list, null)?.duration).toBe(400);
	});
});

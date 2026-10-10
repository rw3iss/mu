import { describe, expect, it } from 'vitest';
import { PeakReducer, waveformBucketCount } from '../peaks.js';

function pcm(values: number[]): Uint8Array {
	const b = new Uint8Array(values.length * 2);
	const v = new DataView(b.buffer);
	for (const [i, x] of values.entries()) v.setInt16(i * 2, x, true);
	return b;
}

describe('PeakReducer', () => {
	it('takes the absolute max per bucket and normalises', () => {
		const r = new PeakReducer(2, 3);
		r.push(pcm([100, -400, 200, 50, 60, -20]));
		expect(r.finish()).toEqual([1, 0.15]);
	});
	it('handles samples split across chunk boundaries', () => {
		const whole = pcm([1000, -2000, 3000, -4000]);
		const r = new PeakReducer(2, 2);
		r.push(whole.slice(0, 3));
		r.push(whole.slice(3));
		expect(r.finish()).toEqual([0.5, 1]);
	});
	it('clamps bucket counts', () => {
		expect(waveformBucketCount(10)).toBe(300);
		expect(waveformBucketCount(240)).toBe(960);
		expect(waveformBucketCount(7200)).toBe(2400);
	});
});

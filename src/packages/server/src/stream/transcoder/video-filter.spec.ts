import { describe, expect, it } from 'vitest';
import { buildVideoFilter } from './video-filter.js';

describe('buildVideoFilter', () => {
	const p = { width: 1920, height: 1080 };
	it('fits and pads SDR sources', () => {
		expect(buildVideoFilter(p, false)).toBe(
			'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
		);
	});
	it('tone maps HDR sources between fit and pad', () => {
		const f = buildVideoFilter(p, true);
		expect(f).toMatch(/^scale=.*,zscale=t=linear.*tonemap=tonemap=hable.*format=yuv420p,pad=/);
	});
});

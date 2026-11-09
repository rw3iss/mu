import { describe, expect, it } from 'vitest';
import { effectiveHeight, resolutionLabel, videoBitDepth } from './video-probe.js';

describe('resolutionLabel', () => {
	it('classifies widescreen 4K by width', () => {
		expect(resolutionLabel(3840, 1634)).toBe('2160p');
		expect(resolutionLabel(3840, 2160)).toBe('2160p');
		expect(resolutionLabel(3836, 1600)).toBe('2160p');
	});
	it('classifies widescreen and 4:3 HD', () => {
		expect(resolutionLabel(1920, 800)).toBe('1080p');
		expect(resolutionLabel(1440, 1080)).toBe('1080p');
		expect(resolutionLabel(1280, 536)).toBe('720p');
		expect(resolutionLabel(720, 480)).toBe('480p');
		expect(resolutionLabel(320, 240)).toBe('240p');
	});
	it('handles missing sizes', () => {
		expect(resolutionLabel(undefined, undefined)).toBeUndefined();
		expect(effectiveHeight(3840, 1634)).toBe(2160);
	});
});

describe('videoBitDepth', () => {
	it('prefers bits_per_raw_sample', () => {
		expect(videoBitDepth({ bits_per_raw_sample: '10', pix_fmt: 'yuv420p' })).toBe(10);
	});
	it('falls back to the pixel format', () => {
		expect(videoBitDepth({ bits_per_raw_sample: 'N/A', pix_fmt: 'yuv420p10le' })).toBe(10);
		expect(videoBitDepth({ pix_fmt: 'yuv420p12le' })).toBe(12);
		expect(videoBitDepth({ pix_fmt: 'yuv420p' })).toBe(8);
		expect(videoBitDepth({})).toBeUndefined();
	});
});

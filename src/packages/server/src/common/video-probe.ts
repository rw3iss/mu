/**
 * Shared helpers for classifying a probed video stream.
 */

const TIERS: readonly [number, string][] = [
	[2160, '2160p'],
	[1080, '1080p'],
	[720, '720p'],
	[480, '480p'],
];

/**
 * The height of the 16:9 frame this picture fits. A widescreen 4K rip
 * (3840x1634) is short but full-width, so it counts as 2160, not 1634.
 */
export function effectiveHeight(width?: number | null, height?: number | null): number {
	const h = height ?? 0;
	const fromWidth = width ? Math.round((width * 9) / 16) : 0;
	return Math.max(h, fromWidth);
}

/** Resolution label ('2160p', '1080p', …) from the frame size; width-aware. */
export function resolutionLabel(width?: number | null, height?: number | null): string | undefined {
	if (!height && !width) return undefined;
	const eff = effectiveHeight(width, height);
	// 3% slack so slightly cropped frames (e.g. 3836 wide) keep their tier.
	for (const [tier, label] of TIERS) if (eff >= tier * 0.97) return label;
	return `${height || eff}p`;
}

/**
 * Bit depth of a video stream. ffprobe leaves `bits_per_raw_sample` empty for
 * AV1 (and often HEVC), so fall back to the pixel format (`yuv420p10le` → 10).
 */
export function videoBitDepth(stream: unknown): number | undefined {
	const s = stream as { bits_per_raw_sample?: string | number; pix_fmt?: string } | undefined;
	const raw = Number.parseInt(String(s?.bits_per_raw_sample ?? ''), 10);
	if (Number.isFinite(raw) && raw > 0) return raw;
	const fmt = String(s?.pix_fmt ?? '');
	if (!fmt) return undefined;
	const m = fmt.match(/p(\d{2})(le|be)$/);
	if (m) return Number(m[1]);
	return /^(yuvj?4[24][024]p|nv12|nv21|gray|rgb24|bgr24)$/.test(fmt) ? 8 : undefined;
}

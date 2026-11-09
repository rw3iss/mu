import { execFileSync } from 'node:child_process';
import { SAFE_INPUT_OPTIONS } from '../../common/ffmpeg-input.js';

/**
 * HDR → SDR tone map (zscale + hable). Browsers get H.264 8-bit BT.709 from
 * every HLS transcode; without this a PQ/HLG source comes out gray and flat.
 */
const TONEMAP =
	'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,' +
	'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

/** BT.709 tags for a tone-mapped (SDR) output. */
export const SDR_COLOR_OPTS = [
	'-color_primaries',
	'bt709',
	'-color_trc',
	'bt709',
	'-colorspace',
	'bt709',
];

/**
 * `-vf` chain for an 8-bit SDR output: fit + (tone map) + letterbox pad.
 * `profile` null = keep the source size (only the tone map, or '' for SDR).
 */
export function buildVideoFilter(
	profile: { width: number; height: number } | null,
	hdr: boolean,
): string {
	if (!profile) return hdr ? TONEMAP : '';
	const { width: w, height: h } = profile;
	const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
	const pad = `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
	return hdr ? `${fit},${TONEMAP},${pad}` : `${fit},${pad}`;
}

const hdrCache = new Map<string, boolean>();

/** True when the first video stream uses an HDR transfer (PQ or HLG). Cached per path. */
export function isHdrSource(filePath: string): boolean {
	const hit = hdrCache.get(filePath);
	if (hit !== undefined) return hit;
	let hdr = false;
	try {
		const out = execFileSync(
			'ffprobe',
			[
				...SAFE_INPUT_OPTIONS,
				'-v',
				'error',
				'-select_streams',
				'v:0',
				'-show_entries',
				'stream=color_transfer',
				'-of',
				'csv=p=0',
				`file:${filePath}`,
			],
			{ encoding: 'utf8', timeout: 15_000 },
		);
		hdr = /smpte2084|arib-std-b67/.test(out);
	} catch {
		hdr = false;
	}
	if (hdrCache.size > 500) hdrCache.clear();
	hdrCache.set(filePath, hdr);
	return hdr;
}

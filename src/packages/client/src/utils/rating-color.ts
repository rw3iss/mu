/**
 * Returns a hex color for a rating on a 0.0–10.0 scale.
 * Uses continuous HSL interpolation for per-decimal precision:
 *   0.0 → red (#e53935)  hue=1°
 *  5.0 → yellow (#fbc02d) hue=45°
 * 10.0 → green (#43a047)  hue=130°
 */
export function getRatingColor(rating: number): string {
	const r = Math.max(0, Math.min(10, rating));

	let h: number;
	if (r <= 5) {
		// Red (1°) → Yellow (45°)
		h = 1 + (r / 5) * 44;
	} else {
		// Yellow (45°) → Green (130°)
		h = 45 + ((r - 5) / 5) * 85;
	}

	// Saturation: slightly higher in the middle (yellow) for vibrancy
	const s = 72 + Math.sin((r / 10) * Math.PI) * 12;
	// Lightness: dip slightly in the middle so yellow isn't washed out
	const l = 46 - Math.sin((r / 10) * Math.PI) * 6;

	return hslToHex(h, s, l);
}

function hslToHex(h: number, s: number, l: number): string {
	const sN = s / 100;
	const lN = l / 100;
	const c = (1 - Math.abs(2 * lN - 1)) * sN;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = lN - c / 2;

	let r = 0,
		g = 0,
		b = 0;
	if (h < 60) {
		r = c;
		g = x;
	} else if (h < 120) {
		r = x;
		g = c;
	} else if (h < 180) {
		g = c;
		b = x;
	} else if (h < 240) {
		g = x;
		b = c;
	} else if (h < 300) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}

	const toHex = (v: number) =>
		Math.round((v + m) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

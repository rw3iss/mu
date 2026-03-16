import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import styles from './ColorPicker.module.scss';

// ── Color conversion helpers ──

interface HSV {
	h: number; // 0–360
	s: number; // 0–1
	v: number; // 0–1
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
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
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): HSV {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d !== 0) {
		if (max === r) h = ((g - b) / d + 6) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
	}
	const s = max === 0 ? 0 : d / max;
	return { h, s, v: max };
}

function hexToRgb(hex: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	let h = m[1]!;
	if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function hexToHsv(hex: string): HSV {
	const rgb = hexToRgb(hex);
	if (!rgb) return { h: 0, s: 0, v: 1 };
	return rgbToHsv(...rgb);
}

function hsvToHex(h: number, s: number, v: number): string {
	return rgbToHex(...hsvToRgb(h, s, v));
}

// ── Component ──

export interface ColorPickerProps {
	value: string;
	onChange: (hex: string) => void;
	size?: number;
}

export function ColorPicker({ value, onChange, size }: ColorPickerProps) {
	const sz = size ?? 28;
	const [open, setOpen] = useState(false);
	const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
	const [hexText, setHexText] = useState(value);
	const [hexError, setHexError] = useState(false);

	const popupRef = useRef<HTMLDivElement>(null);
	const satCanvasRef = useRef<HTMLCanvasElement>(null);
	const hueCanvasRef = useRef<HTMLCanvasElement>(null);
	const draggingSat = useRef(false);
	const draggingHue = useRef(false);

	// Sync from external value changes
	useEffect(() => {
		setHsv(hexToHsv(value));
		setHexText(value);
		setHexError(false);
	}, [value]);

	// Close on outside click
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [open]);

	// ── Draw saturation/brightness canvas ──
	const drawSatCanvas = useCallback((hue: number) => {
		const canvas = satCanvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const w = canvas.width;
		const h = canvas.height;

		// Base hue fill
		const [r, g, b] = hsvToRgb(hue, 1, 1);
		ctx.fillStyle = `rgb(${r},${g},${b})`;
		ctx.fillRect(0, 0, w, h);

		// White gradient (left to right)
		const white = ctx.createLinearGradient(0, 0, w, 0);
		white.addColorStop(0, 'rgba(255,255,255,1)');
		white.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = white;
		ctx.fillRect(0, 0, w, h);

		// Black gradient (top to bottom)
		const black = ctx.createLinearGradient(0, 0, 0, h);
		black.addColorStop(0, 'rgba(0,0,0,0)');
		black.addColorStop(1, 'rgba(0,0,0,1)');
		ctx.fillStyle = black;
		ctx.fillRect(0, 0, w, h);
	}, []);

	// ── Draw hue bar ──
	const drawHueCanvas = useCallback(() => {
		const canvas = hueCanvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const w = canvas.width;
		const h = canvas.height;
		const gradient = ctx.createLinearGradient(0, 0, w, 0);
		for (let i = 0; i <= 6; i++) {
			const [r, g, b] = hsvToRgb(i * 60, 1, 1);
			gradient.addColorStop(i / 6, `rgb(${r},${g},${b})`);
		}
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, w, h);
	}, []);

	// Redraw canvases when popup opens or hue changes
	useEffect(() => {
		if (!open) return;
		// Small delay to ensure canvas is mounted
		requestAnimationFrame(() => {
			drawSatCanvas(hsv.h);
			drawHueCanvas();
		});
	}, [open, hsv.h, drawSatCanvas, drawHueCanvas]);

	// ── Emit color change ──
	const emitChange = useCallback(
		(newHsv: HSV) => {
			const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
			setHexText(hex);
			setHexError(false);
			onChange(hex);
		},
		[onChange],
	);

	// ── Saturation canvas interaction ──
	const handleSatInteraction = useCallback(
		(e: MouseEvent) => {
			const canvas = satCanvasRef.current;
			if (!canvas) return;
			const rect = canvas.getBoundingClientRect();
			const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
			const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
			const newHsv = { h: hsv.h, s: x, v: 1 - y };
			setHsv(newHsv);
			emitChange(newHsv);
		},
		[hsv.h, emitChange],
	);

	const onSatDown = useCallback(
		(e: MouseEvent) => {
			e.preventDefault();
			draggingSat.current = true;
			handleSatInteraction(e);

			const onMove = (ev: MouseEvent) => {
				if (draggingSat.current) handleSatInteraction(ev);
			};
			const onUp = () => {
				draggingSat.current = false;
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[handleSatInteraction],
	);

	// ── Hue bar interaction ──
	const handleHueInteraction = useCallback(
		(e: MouseEvent) => {
			const canvas = hueCanvasRef.current;
			if (!canvas) return;
			const rect = canvas.getBoundingClientRect();
			const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
			const newHsv = { h: x * 360, s: hsv.s, v: hsv.v };
			setHsv(newHsv);
			drawSatCanvas(newHsv.h);
			emitChange(newHsv);
		},
		[hsv.s, hsv.v, emitChange, drawSatCanvas],
	);

	const onHueDown = useCallback(
		(e: MouseEvent) => {
			e.preventDefault();
			draggingHue.current = true;
			handleHueInteraction(e);

			const onMove = (ev: MouseEvent) => {
				if (draggingHue.current) handleHueInteraction(ev);
			};
			const onUp = () => {
				draggingHue.current = false;
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[handleHueInteraction],
	);

	// ── Hex input ──
	const applyHex = useCallback(() => {
		const rgb = hexToRgb(hexText);
		if (rgb) {
			const newHsv = rgbToHsv(...rgb);
			setHsv(newHsv);
			const hex = rgbToHex(...rgb);
			setHexText(hex);
			setHexError(false);
			onChange(hex);
		} else if (hexText.trim()) {
			setHexError(true);
		}
	}, [hexText, onChange]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(value);
	}, [value]);

	return (
		<div class={styles.wrapper} ref={popupRef}>
			<button
				class={styles.swatch}
				style={{ backgroundColor: value, width: sz, height: sz }}
				onClick={() => setOpen(!open)}
				title="Pick color"
			/>

			{open && (
				<div class={styles.popup}>
					{/* Saturation / Brightness area */}
					<div class={styles.satArea}>
						<canvas
							ref={satCanvasRef}
							class={styles.satCanvas}
							width={220}
							height={150}
							onMouseDown={onSatDown}
						/>
						<div
							class={styles.satThumb}
							style={{
								left: `${hsv.s * 100}%`,
								top: `${(1 - hsv.v) * 100}%`,
							}}
						/>
					</div>

					{/* Hue slider */}
					<div class={styles.hueBar}>
						<canvas
							ref={hueCanvasRef}
							class={styles.hueCanvas}
							width={220}
							height={12}
							onMouseDown={onHueDown}
						/>
						<div class={styles.hueThumb} style={{ left: `${(hsv.h / 360) * 100}%` }} />
					</div>

					{/* Hex input row */}
					<div class={styles.hexRow}>
						<div class={styles.previewSwatch} style={{ backgroundColor: value }} />
						<input
							type="text"
							class={`${styles.hexInput} ${hexError ? styles.hexInputError : ''}`}
							value={hexText}
							onInput={(e) => {
								setHexText((e.target as HTMLInputElement).value);
								setHexError(false);
							}}
							onBlur={applyHex}
							onKeyDown={(e) => e.key === 'Enter' && applyHex()}
							spellcheck={false}
						/>
						<button class={styles.copyBtn} onClick={handleCopy} title="Copy hex">
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<rect x="9" y="9" width="13" height="13" rx="2" />
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
							</svg>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

import { useUiSetting } from '@/hooks/useUiSetting';
import styles from './SubtitleAppearance.module.scss';

export interface SubtitleSettings {
	fontSize: number;
	/** Line spacing offset in pixels from the default for the current font size. */
	lineSpacing: number;
	fontColor: string;
	backgroundColor: string;
	backgroundOpacity: number;
	textOpacity: number;
	shadowColor: string;
	verticalOffset: number;
	timingOffsetMs: number;
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
	fontSize: 100,
	lineSpacing: 0,
	fontColor: '#ffffff',
	backgroundColor: '#000000',
	backgroundOpacity: 0.6,
	textOpacity: 1,
	shadowColor: '#000000',
	verticalOffset: 0,
	timingOffsetMs: 0,
};

export function useSubtitleSettings(): [SubtitleSettings, (s: SubtitleSettings) => void] {
	return useUiSetting<SubtitleSettings>('subtitle_appearance', DEFAULT_SUBTITLE_SETTINGS);
}

interface SubtitleAppearanceProps {
	/** Compact mode for player panel (no section titles, tighter spacing) */
	compact?: boolean;
}

export function SubtitleAppearance({ compact }: SubtitleAppearanceProps) {
	const [settings, setSettings] = useSubtitleSettings();

	const update = <K extends keyof SubtitleSettings>(key: K, value: SubtitleSettings[K]) => {
		const next = { ...settings, [key]: value };
		// Reset line spacing to default (0) when font size changes
		if (key === 'fontSize') {
			next.lineSpacing = 0;
		}
		setSettings(next);
	};

	const reset = () => setSettings({ ...DEFAULT_SUBTITLE_SETTINGS });

	const wrapClass = compact ? `${styles.wrap} ${styles.compact}` : styles.wrap;

	return (
		<div class={wrapClass}>
			{!compact && <h3 class={styles.sectionTitle}>Subtitles</h3>}

			{/* Font Size */}
			<div class={styles.row}>
				<span class={styles.label}>Font Size</span>
				<div class={styles.control}>
					<input
						type="range"
						class={styles.slider}
						min={50}
						max={200}
						step={5}
						value={settings.fontSize}
						onInput={(e) =>
							update('fontSize', parseInt((e.target as HTMLInputElement).value, 10))
						}
					/>
					<span class={styles.value}>{settings.fontSize}%</span>
				</div>
			</div>

			{/* Line Height */}
			<div class={styles.row}>
				<span class={styles.label}>Line Spacing</span>
				<div class={styles.control}>
					<input
						type="number"
						class={styles.numberInput}
						value={settings.lineSpacing}
						onChange={(e) => {
							const val = parseInt((e.target as HTMLInputElement).value, 10);
							if (!Number.isNaN(val)) update('lineSpacing', val);
						}}
					/>
					<span class={styles.unit}>px</span>
					<button
						class={styles.offsetBtn}
						onClick={() => update('lineSpacing', (settings.lineSpacing || 0) - 1)}
					>
						-
					</button>
					<button
						class={styles.offsetBtn}
						onClick={() => update('lineSpacing', (settings.lineSpacing || 0) + 1)}
					>
						+
					</button>
					<button
						class={styles.offsetBtn}
						onClick={() => update('lineSpacing', 0)}
						title="Reset line spacing"
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<polyline points="1 4 1 10 7 10" />
							<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
						</svg>
					</button>
				</div>
			</div>

			{/* Font Color */}
			<div class={styles.row}>
				<span class={styles.label}>Font Color</span>
				<div class={styles.control}>
					<input
						type="color"
						class={styles.colorPicker}
						value={settings.fontColor}
						onInput={(e) => update('fontColor', (e.target as HTMLInputElement).value)}
					/>
					<span class={styles.value}>{settings.fontColor}</span>
				</div>
			</div>

			{/* Text Opacity */}
			<div class={styles.row}>
				<span class={styles.label}>Text Opacity</span>
				<div class={styles.control}>
					<input
						type="range"
						class={styles.slider}
						min={0}
						max={1}
						step={0.05}
						value={settings.textOpacity}
						onInput={(e) =>
							update('textOpacity', parseFloat((e.target as HTMLInputElement).value))
						}
					/>
					<span class={styles.value}>{Math.round(settings.textOpacity * 100)}%</span>
				</div>
			</div>

			{/* Shadow Color */}
			<div class={styles.row}>
				<span class={styles.label}>Shadow Color</span>
				<div class={styles.control}>
					<input
						type="color"
						class={styles.colorPicker}
						value={settings.shadowColor}
						onInput={(e) => update('shadowColor', (e.target as HTMLInputElement).value)}
					/>
					<span class={styles.value}>{settings.shadowColor}</span>
				</div>
			</div>

			{/* Background Color */}
			<div class={styles.row}>
				<span class={styles.label}>Background</span>
				<div class={styles.control}>
					<input
						type="color"
						class={styles.colorPicker}
						value={settings.backgroundColor}
						onInput={(e) =>
							update('backgroundColor', (e.target as HTMLInputElement).value)
						}
					/>
					<span class={styles.value}>{settings.backgroundColor}</span>
				</div>
			</div>

			{/* Background Opacity */}
			<div class={styles.row}>
				<span class={styles.label}>BG Opacity</span>
				<div class={styles.control}>
					<input
						type="range"
						class={styles.slider}
						min={0}
						max={1}
						step={0.05}
						value={settings.backgroundOpacity}
						onInput={(e) =>
							update(
								'backgroundOpacity',
								parseFloat((e.target as HTMLInputElement).value),
							)
						}
					/>
					<span class={styles.value}>
						{Math.round(settings.backgroundOpacity * 100)}%
					</span>
				</div>
			</div>

			{/* Vertical Offset */}
			<div class={styles.row}>
				<span class={styles.label}>Vertical Offset</span>
				<div class={styles.control}>
					<input
						type="number"
						class={styles.numberInput}
						value={settings.verticalOffset}
						onChange={(e) => {
							const val = parseInt((e.target as HTMLInputElement).value, 10);
							if (!Number.isNaN(val)) update('verticalOffset', val);
						}}
					/>
					<span class={styles.unit}>px</span>
					<button
						class={styles.offsetBtn}
						onClick={() => update('verticalOffset', (settings.verticalOffset || 0) - 1)}
					>
						-
					</button>
					<button
						class={styles.offsetBtn}
						onClick={() => update('verticalOffset', (settings.verticalOffset || 0) + 1)}
					>
						+
					</button>
					<button
						class={styles.offsetBtn}
						onClick={() => update('verticalOffset', 0)}
						title="Reset vertical offset"
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<polyline points="1 4 1 10 7 10" />
							<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
						</svg>
					</button>
				</div>
			</div>

			{/* Timing Offset */}
			<div class={styles.row}>
				<span class={styles.label}>Timing Offset</span>
				<div class={styles.control}>
					<input
						type="number"
						class={styles.numberInput}
						value={settings.timingOffsetMs}
						step={100}
						onChange={(e) => {
							const val = parseInt((e.target as HTMLInputElement).value, 10);
							if (!Number.isNaN(val)) update('timingOffsetMs', val);
						}}
					/>
					<span class={styles.unit}>ms</span>
					<button
						class={styles.offsetBtn}
						onClick={() =>
							update('timingOffsetMs', (settings.timingOffsetMs || 0) - 100)
						}
					>
						-100
					</button>
					<button
						class={styles.offsetBtn}
						onClick={() =>
							update('timingOffsetMs', (settings.timingOffsetMs || 0) + 100)
						}
					>
						+100
					</button>
					<button
						class={styles.offsetBtn}
						onClick={() => update('timingOffsetMs', 0)}
						title="Reset timing offset"
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<polyline points="1 4 1 10 7 10" />
							<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
						</svg>
					</button>
				</div>
			</div>

			{/* Reset */}
			<button class={styles.resetBtn} onClick={reset}>
				Reset Defaults
			</button>
		</div>
	);
}

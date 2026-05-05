import {
	bassEnhanceAmount,
	bassEnhanceEnabled,
	hrtfSurroundAmount,
	hrtfSurroundEnabled,
	setBassEnhanceAmount,
	setHrtfSurroundAmount,
	setStereoWidthAmount,
	stereoWidthAmount,
	stereoWidthEnabled,
	toggleBassEnhance,
	toggleHrtfSurround,
	toggleStereoWidth,
} from '@/state/audio-effects.state';
import styles from '../EffectsPanel.module.scss';

interface EffectRowProps {
	label: string;
	help: string;
	enabled: boolean;
	onToggle: () => void;
	amount: number;
	min: number;
	max: number;
	step: number;
	onAmount: (n: number) => void;
	formatAmount: (n: number) => string;
}

function EffectRow({
	label,
	help,
	enabled,
	onToggle,
	amount,
	min,
	max,
	step,
	onAmount,
	formatAmount,
}: EffectRowProps) {
	return (
		<div class={styles.enhanceRow}>
			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>
					{label}
					<span class={styles.autoHelp} title={help}>
						?
					</span>
				</span>
				<button
					class={`${styles.toggle} ${enabled ? styles.on : ''}`}
					onClick={onToggle}
					aria-label={`Toggle ${label}`}
				/>
			</div>
			<div class={`${styles.compParam} ${enabled ? '' : styles.compParamDimmed}`}>
				<div class={styles.compParamHeader}>
					<span class={styles.compParamLabel}>Amount</span>
					<span class={styles.compParamValue}>{formatAmount(amount)}</span>
				</div>
				<input
					type="range"
					class={styles.compSlider}
					min={min}
					max={max}
					step={step}
					value={amount}
					disabled={!enabled}
					onInput={(e) => onAmount(parseFloat((e.target as HTMLInputElement).value))}
				/>
			</div>
		</div>
	);
}

export function EnhanceTab() {
	return (
		<div>
			<EffectRow
				label="Stereo Width"
				help="Mid/Side processing — boosts the stereo difference between L and R to make ambience and music feel wider, while keeping centre-panned content (dialogue) unchanged. Width 1.0 = no change, 0 = mono, 2.0 = max wide. Best on stereo source material; little effect on mono content."
				enabled={stereoWidthEnabled.value}
				onToggle={toggleStereoWidth}
				amount={stereoWidthAmount.value}
				min={0}
				max={2}
				step={0.05}
				onAmount={setStereoWidthAmount}
				formatAmount={(n) => `${n.toFixed(2)}×`}
			/>
			<EffectRow
				label="Bass Enhance"
				help="Adds harmonic overtones to low frequencies via gentle saturation. Your ear interprets the harmonics as deeper bass even on small speakers that can't physically reproduce the fundamentals — gives perceived punch without needing more low-end energy. Especially useful on laptop / phone speakers."
				enabled={bassEnhanceEnabled.value}
				onToggle={toggleBassEnhance}
				amount={bassEnhanceAmount.value}
				min={0}
				max={1}
				step={0.05}
				onAmount={setBassEnhanceAmount}
				formatAmount={(n) => `${Math.round(n * 100)}%`}
			/>
			<EffectRow
				label="HRTF Surround"
				help="Headphones-only effect: positions the L and R channels as virtual speakers in 3D space using HRTF (head-related transfer function) panning. Gives an 'out-of-the-head' impression closer to listening over real speakers. Higher amount widens the virtual stage. Has no benefit on built-in laptop speakers."
				enabled={hrtfSurroundEnabled.value}
				onToggle={toggleHrtfSurround}
				amount={hrtfSurroundAmount.value}
				min={0}
				max={1}
				step={0.05}
				onAmount={setHrtfSurroundAmount}
				formatAmount={(n) => `${Math.round(n * 100)}%`}
			/>
		</div>
	);
}

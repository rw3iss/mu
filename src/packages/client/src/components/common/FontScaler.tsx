import {
	resetTextScale,
	setTextScale,
	TEXT_SCALE_VALUES,
	type TextScale,
	textScale,
} from '@/state/appearance.state';
import styles from './FontScaler.module.scss';

const LABELS = ['XS', 'S', 'M', 'L', 'XL'];

export function FontScaler() {
	const currentIndex = TEXT_SCALE_VALUES.indexOf(textScale.value as TextScale);
	const activeIndex = currentIndex === -1 ? 2 : currentIndex; // default to middle (1.0)

	return (
		<div class={styles.wrap}>
			<div class={styles.track}>
				{/* Fill line up to active position */}
				<div
					class={styles.trackFill}
					style={{ width: `${(activeIndex / (TEXT_SCALE_VALUES.length - 1)) * 100}%` }}
				/>

				{/* Dots */}
				{TEXT_SCALE_VALUES.map((val, i) => (
					<button
						key={val}
						class={`${styles.dot} ${i === activeIndex ? styles.dotActive : ''}`}
						onClick={() => setTextScale(val)}
						title={`${val}x`}
						aria-label={`Font scale ${LABELS[i]} (${val}x)`}
					>
						{i === activeIndex && <span class={styles.handle} />}
					</button>
				))}
			</div>
			<div class={styles.labels}>
				{LABELS.map((label, i) => (
					<span
						key={label}
						class={`${styles.label} ${i === activeIndex ? styles.labelActive : ''}`}
					>
						{label}
					</span>
				))}
			</div>
		</div>
	);
}

export { resetTextScale };

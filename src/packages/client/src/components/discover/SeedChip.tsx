import styles from './SeedChip.module.scss';

interface SeedChipProps {
	label: string;
	onRemove: () => void;
}

/**
 * Pill showing one seed (movie / collection) feeding the
 * recommendation request. Clicking the × removes it; clearing
 * all seeds reverts to personalised mode.
 */
export function SeedChip({ label, onRemove }: SeedChipProps) {
	return (
		<span class={styles.chip}>
			<span class={styles.label}>{label}</span>
			<button
				class={styles.x}
				onClick={onRemove}
				aria-label={`Remove ${label}`}
				title="Remove"
			>
				×
			</button>
		</span>
	);
}

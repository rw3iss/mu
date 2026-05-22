import styles from './SeedChip.module.scss';

interface SeedChipProps {
	label: string;
	onRemove: () => void;
	/** Visual variant — defaults to movie. */
	kind?: 'movie' | 'person';
}

/**
 * Pill showing one seed (movie or person) feeding the recommendation
 * request. Clicking the × removes it; clearing all seeds reverts to
 * personalised mode. Person chips have a slightly different tint plus
 * a leading 👤 glyph so they're scannable in mixed lists.
 */
export function SeedChip({ label, onRemove, kind = 'movie' }: SeedChipProps) {
	return (
		<span class={`${styles.chip} ${kind === 'person' ? styles.person : ''}`}>
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

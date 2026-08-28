import type { IncludeMode } from '@/services/discover.service';
import styles from './IncludeToggle.module.scss';

const OPTIONS: { id: IncludeMode; label: string; title: string }[] = [
	{ id: 'owned', label: 'In Library', title: 'Only movies in your library' },
	{ id: 'all', label: 'All', title: 'Library + not-in-library suggestions' },
	{
		id: 'notOwned',
		label: 'Not in Library',
		title: "Only movies you don't have yet — bookmark to remember",
	},
];

interface IncludeToggleProps {
	value: IncludeMode;
	onChange: (mode: IncludeMode) => void;
}

/**
 * Three-way radio control for the Discover page's "what to show"
 * dimension. Lives in the page header above the seed/filter area.
 *
 * Semantically a mode, not a filter — placed in the header rather
 * than the sidebar so it reads as scoping the entire query.
 */
export function IncludeToggle({ value, onChange }: IncludeToggleProps) {
	return (
		<div class={styles.includeToggle} role="radiogroup" aria-label="Include">
			{OPTIONS.map((o) => (
				<button
					key={o.id}
					type="button"
					title={o.title}
					class={`${styles.includeBtn} ${value === o.id ? styles.includeActive : ''}`}
					onClick={() => onChange(o.id)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

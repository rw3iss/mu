import type { BrowseMode } from '@mu/shared';
import { route } from 'preact-router';
import { currentPath } from '@/app';
import { Icon } from '@/components/common/Icon';
import {
	browseMode,
	canToggleBrowseMode,
	equivalentPath,
	setBrowseMode,
} from '@/state/browseMode.state';
import styles from './BrowseModeToggle.module.scss';

const MODES: { id: BrowseMode; label: string; icon: 'film' | 'music' }[] = [
	{ id: 'movies', label: 'Movies', icon: 'film' },
	{ id: 'music', label: 'Music', icon: 'music' },
];

/**
 * Header Movies | Music segmented control. Hidden when only one feature is
 * enabled. Switching navigates to the equivalent page in the other mode.
 */
export function BrowseModeToggle() {
	if (!canToggleBrowseMode.value) return null;
	const active = browseMode.value;

	const select = (mode: BrowseMode) => {
		if (mode === active) return;
		const target = equivalentPath(currentPath.value, mode);
		setBrowseMode(mode);
		if (target !== currentPath.value) route(target);
	};

	return (
		<div class={styles.toggle} role="radiogroup" aria-label="Browse mode">
			{MODES.map((m) => (
				<button
					key={m.id}
					type="button"
					role="radio"
					aria-checked={active === m.id}
					class={`${styles.segment} ${active === m.id ? styles.active : ''}`}
					onClick={() => select(m.id)}
					title={`Browse ${m.label.toLowerCase()}`}
				>
					<Icon name={m.icon} size={16} />
					<span class={styles.label}>{m.label}</span>
				</button>
			))}
		</div>
	);
}

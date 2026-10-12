import type { BrowseMode } from '@mu/shared';
import { route } from 'preact-router';
import { currentPath } from '@/app';
import { Icon } from '@/components/common/Icon';
import { browseMode, canToggleBrowseMode, setBrowseMode } from '@/state/browseMode.state';
import styles from './BrowseModeToggle.module.scss';

const MODES: { id: BrowseMode; label: string; icon: 'film' | 'music'; library: string }[] = [
	{ id: 'movies', label: 'Movies', icon: 'film', library: '/library' },
	{ id: 'music', label: 'Music', icon: 'music', library: '/music/library' },
];

/**
 * Header Movies | Music segmented control. Hidden when only one feature is
 * enabled. Each segment always opens that mode's library (/library or
 * /music/library), even when the mode is already active.
 */
export function BrowseModeToggle() {
	if (!canToggleBrowseMode.value) return null;
	const active = browseMode.value;

	const select = (m: (typeof MODES)[number]) => {
		setBrowseMode(m.id);
		if (currentPath.value !== m.library) route(m.library);
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
					onClick={() => select(m)}
					title={`${m.label} library`}
				>
					<Icon name={m.icon} size={16} />
					<span class={styles.label}>{m.label}</span>
				</button>
			))}
		</div>
	);
}

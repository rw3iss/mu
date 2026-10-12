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
 * enabled. Clicking the other mode switches to the equivalent page; clicking
 * the active mode opens its library (/library or /music/library).
 */
export function BrowseModeToggle() {
	if (!canToggleBrowseMode.value) return null;
	const active = browseMode.value;

	const select = (m: (typeof MODES)[number]) => {
		if (m.id === active) {
			// Second click on the active mode: go to its library.
			if (currentPath.value !== m.library) route(m.library);
			return;
		}
		// Switch mode, staying on the equivalent page.
		const target = equivalentPath(currentPath.value, m.id);
		setBrowseMode(m.id);
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
					onClick={() => select(m)}
					title={
						active === m.id ? `${m.label} library` : `Browse ${m.label.toLowerCase()}`
					}
				>
					<Icon name={m.icon} size={16} />
					<span class={styles.label}>{m.label}</span>
				</button>
			))}
		</div>
	);
}

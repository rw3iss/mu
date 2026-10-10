import { Icon } from '@/components/common/Icon';
import { quality } from '@/state/player.state';
import styles from '../../PlayerControls.module.scss';
import type { SettingsMenuApi } from './types';

export function QualityPanel({ session, openPanel, close }: SettingsMenuApi) {
	const handleQualitySelect = (q: string) => {
		quality.value = q;
		close();
	};

	return (
		<>
			<button class={styles.menuBack} onClick={() => openPanel('main')}>
				<Icon name="chevron-left" size={14} /> Quality
			</button>
			<button
				class={`${styles.menuItem} ${quality.value === 'auto' ? styles.selected : ''}`}
				onClick={() => handleQualitySelect('auto')}
			>
				Auto
			</button>
			{(session?.qualities ?? []).map((q) => (
				<button
					key={q.label}
					class={`${styles.menuItem} ${quality.value === q.label ? styles.selected : ''}`}
					onClick={() => handleQualitySelect(q.label)}
				>
					{q.label} ({q.height}p)
				</button>
			))}
		</>
	);
}

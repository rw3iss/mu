import type { ComponentChildren } from 'preact';
import { Icon } from '@/components/common/Icon';
import { useUiSetting } from '@/hooks/useUiSetting';
import styles from '../EffectsPanel.module.scss';

interface CollapsibleSettingsProps {
	settingKey: string;
	children: ComponentChildren;
}

/**
 * Per-tab "Settings" twisty that remembers its open/closed state in
 * localStorage via the supplied `settingKey`. Used inside each tab to
 * tuck the parameter sliders behind a single click — keeps the
 * effects panel compact when the user just wants to glance at the
 * profile dropdown.
 */
export function CollapsibleSettings({ settingKey, children }: CollapsibleSettingsProps) {
	const [open, setOpen] = useUiSetting(settingKey, false);
	return (
		<div class={styles.collapsible}>
			<button class={styles.collapsibleToggle} onClick={() => setOpen(!open)}>
				<span>Settings</span>
				<span class={styles.collapsibleArrow}>
					<Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
				</span>
			</button>
			{open && <div class={styles.collapsibleContent}>{children}</div>}
		</div>
	);
}

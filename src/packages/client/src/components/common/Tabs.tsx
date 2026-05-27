import type { ComponentChildren } from 'preact';
import { useCallback } from 'preact/hooks';
import styles from './Tabs.module.scss';

interface Tab {
	id: string;
	label: ComponentChildren;
	/**
	 * Optional inline annotation rendered next to the label (e.g. a
	 * profile-name pill or an "ON" badge). Lets surfaces like the
	 * effects panel and per-section settings use this shared component
	 * without losing their secondary signal.
	 */
	badge?: ComponentChildren;
	/** Disables the tab — pointer events off, dimmed style. */
	disabled?: boolean;
}

interface TabsProps {
	tabs: Tab[];
	activeTab: string;
	onTabChange: (id: string) => void;
	class?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, class: className }: TabsProps) {
	const handleClick = useCallback(
		(id: string, disabled?: boolean) => {
			if (disabled) return;
			if (id !== activeTab) onTabChange(id);
		},
		[activeTab, onTabChange],
	);

	return (
		<div class={`${styles.tabs} ${className || ''}`} role="tablist">
			{tabs.map((tab) => (
				<button
					key={tab.id}
					role="tab"
					class={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
					aria-selected={activeTab === tab.id}
					aria-disabled={tab.disabled || undefined}
					disabled={tab.disabled}
					onClick={() => handleClick(tab.id, tab.disabled)}
				>
					<span class={styles.tabLabel}>{tab.label}</span>
					{tab.badge != null && <span class={styles.tabBadge}>{tab.badge}</span>}
				</button>
			))}
		</div>
	);
}

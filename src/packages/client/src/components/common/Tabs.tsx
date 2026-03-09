import { useCallback } from 'preact/hooks';
import styles from './Tabs.module.scss';

interface Tab {
	id: string;
	label: string;
}

interface TabsProps {
	tabs: Tab[];
	activeTab: string;
	onTabChange: (id: string) => void;
	class?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, class: className }: TabsProps) {
	const handleClick = useCallback(
		(id: string) => {
			if (id !== activeTab) {
				onTabChange(id);
			}
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
					onClick={() => handleClick(tab.id)}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

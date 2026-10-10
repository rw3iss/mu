import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { activeKind } from '@/state/globalPlayer.state';
import styles from '../PlayerControls.module.scss';
import { getSettingsMenuSpec } from './settings';
import type { SettingsMenuApi } from './settings/types';
import type { ControlGroupProps } from './types';

/**
 * Settings gear + popup menu. The root rows and submenu panels come from the
 * active media kind's {@link SettingsMenuSpec}, so a new kind plugs in its
 * own entries without touching this component.
 */
export function SettingsMenu({ session }: ControlGroupProps) {
	const [showSettingsMenu, setShowSettingsMenu] = useState(false);
	const [settingsPanel, setSettingsPanel] = useState<string>('main');
	const settingsRef = useRef<HTMLDivElement>(null);
	const spec = getSettingsMenuSpec(activeKind.value);

	// Close settings on outside click
	useEffect(() => {
		if (!showSettingsMenu) return;
		function handleClick(e: MouseEvent) {
			const target = e.target as HTMLElement;
			// Ignore clicks inside a portaled dialog (e.g. the delete-subtitle
			// confirm modal), which renders under document.body via a portal —
			// outside settingsRef. Without this, mousedown on the dialog tears
			// the menu (and the dialog) down before its click handler runs.
			if (target.closest?.('[role="dialog"]')) return;
			if (settingsRef.current && !settingsRef.current.contains(target as Node)) {
				setShowSettingsMenu(false);
				setSettingsPanel('main');
			}
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [showSettingsMenu]);

	const toggleSettings = useCallback(() => {
		setShowSettingsMenu((v) => !v);
		setSettingsPanel('main');
	}, []);

	const close = useCallback(() => {
		setShowSettingsMenu(false);
		setSettingsPanel('main');
	}, []);

	const api: SettingsMenuApi = { session, openPanel: setSettingsPanel, close };
	const Panel =
		settingsPanel === 'main'
			? null
			: spec.panels.find((p) => p.id === settingsPanel)?.Component;

	return (
		<div class={styles.menuContainer} ref={settingsRef}>
			<button
				class={`${styles.controlBtn} ${showSettingsMenu ? styles.active : ''}`}
				onClick={toggleSettings}
				aria-label="Settings"
				title="Settings"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="white"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</svg>
			</button>

			{showSettingsMenu && (
				<div class={styles.menu}>
					{settingsPanel === 'main' &&
						spec.items.map(({ id, Component }) => <Component key={id} {...api} />)}
					{Panel && <Panel {...api} />}
				</div>
			)}
		</div>
	);
}

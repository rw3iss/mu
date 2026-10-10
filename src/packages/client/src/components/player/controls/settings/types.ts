import type { FunctionComponent } from 'preact';
import type { StreamSession } from '@/state/player.state';

/** What every settings-menu row / submenu panel gets from `SettingsMenu`. */
export interface SettingsMenuApi {
	session: StreamSession | null;
	/** Switch the menu to a submenu panel by id (`'main'` = the root list). */
	openPanel: (id: string) => void;
	/** Close the menu (and reset it to the root list). */
	close: () => void;
}

export interface SettingsEntry {
	id: string;
	Component: FunctionComponent<SettingsMenuApi>;
}

/**
 * A kind's settings menu: root rows in display order, plus the submenu
 * panels those rows can open.
 */
export interface SettingsMenuSpec {
	items: SettingsEntry[];
	panels: SettingsEntry[];
}

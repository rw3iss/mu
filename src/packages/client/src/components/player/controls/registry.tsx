import type { FunctionComponent } from 'preact';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import type { ControlGroupId } from '@/state/player/types';
import { EffectsButton } from './EffectsButton';
import { FullscreenButton } from './FullscreenButton';
import { InfoButton } from './InfoButton';
import { MobileOverflowMenu } from './MobileOverflowMenu';
import { NowPlayingTitle } from './NowPlayingTitle';
import { PipButton } from './PipButton';
import { QueueButton } from './QueueButton';
import { SeekBar } from './SeekBar';
import { SettingsMenu } from './SettingsMenu';
import { SharedSessionButton } from './SharedSessionButton';
import { SnippetIndicator } from './SnippetIndicator';
import { TransportGroup } from './TransportGroup';
import type { ControlGroupProps } from './types';
import { VolumeControl } from './VolumeControl';

/** Plugin buttons — rendered before the system buttons. */
function PluginButtons() {
	return <PluginSlot name={UI.PLAYER_BUTTON} context={{}} />;
}

/** Control-group id → component. Every group receives {@link ControlGroupProps}. */
export const CONTROL_GROUPS: Record<ControlGroupId, FunctionComponent<ControlGroupProps>> = {
	seek: SeekBar,
	title: NowPlayingTitle,
	transport: TransportGroup,
	plugins: PluginButtons,
	snippet: SnippetIndicator,
	sharedSession: SharedSessionButton,
	info: InfoButton,
	queue: QueueButton,
	effects: EffectsButton,
	volume: () => <VolumeControl />,
	settings: SettingsMenu,
	mobileOverflow: MobileOverflowMenu,
	pip: PipButton,
	fullscreen: FullscreenButton,
};

/** Groups with a fixed zone in the bar; every other group goes in the right cluster. */
export const ZONED_GROUPS: ReadonlySet<ControlGroupId> = new Set(['seek', 'title', 'transport']);

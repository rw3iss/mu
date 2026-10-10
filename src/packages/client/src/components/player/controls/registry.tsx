import type { FunctionComponent } from 'preact';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import type { ControlGroupId } from '@/state/player/types';
import { EffectsButton } from './EffectsButton';
import { ExpandButton } from './ExpandButton';
import { FullscreenButton } from './FullscreenButton';
import { InfoButton } from './InfoButton';
import { MobileOverflowMenu } from './MobileOverflowMenu';
import { NowPlayingTitle } from './NowPlayingTitle';
import { PipButton } from './PipButton';
import { QueueButton } from './QueueButton';
import { SeekBar } from './SeekBar';
import { SettingsMenu } from './SettingsMenu';
import { SharedSessionButton } from './SharedSessionButton';
import { RepeatButton, ShuffleButton } from './ShuffleRepeat';
import { SnippetIndicator } from './SnippetIndicator';
import { TrackTitle } from './TrackTitle';
import { TrackTransport } from './TrackTransport';
import { TransportGroup } from './TransportGroup';
import type { ControlGroupProps } from './types';
import { VolumeControl } from './VolumeControl';
import { WaveformSeekBar } from './WaveformSeekBar';

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
	waveform: WaveformSeekBar,
	trackTitle: TrackTitle,
	trackTransport: TrackTransport,
	shuffle: ShuffleButton,
	repeat: RepeatButton,
	expand: ExpandButton,
};

/** Zone → the group ids that can fill it (first one in the toolbar wins). */
export const ZONE_GROUPS = {
	seek: ['seek', 'waveform'],
	title: ['title', 'trackTitle'],
	transport: ['transport', 'trackTransport'],
} as const satisfies Record<string, readonly ControlGroupId[]>;

/** Groups with a fixed zone in the bar; every other group goes in the right cluster. */
export const ZONED_GROUPS: ReadonlySet<ControlGroupId> = new Set<ControlGroupId>([
	...ZONE_GROUPS.seek,
	...ZONE_GROUPS.title,
	...ZONE_GROUPS.transport,
]);

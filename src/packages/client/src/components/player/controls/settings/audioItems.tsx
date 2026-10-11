import type { ReplayGainMode } from '@mu/shared';
import { Icon } from '@/components/common/Icon';
import { setUiSetting } from '@/hooks/useUiSetting';
import {
	MUSIC_GAPLESS_KEY,
	MUSIC_REPLAYGAIN_KEY,
	musicGapless,
	musicReplayGain,
	musicStreamProfile,
	setStreamProfile,
} from '@/state/musicPlayer.state';
import { QUALITY_NAMES, qualityOptions } from '@/utils/music-quality';
import styles from '../../PlayerControls.module.scss';
import type { SettingsMenuApi } from './types';

/** Audio settings rows + submenus (stream quality, ReplayGain, gapless). */

const REPLAYGAIN_LABELS: Record<ReplayGainMode, string> = {
	off: 'Off',
	track: 'Track',
	album: 'Album',
};

function SubmenuRow({
	label,
	value,
	onClick,
}: {
	label: string;
	value: string;
	onClick: () => void;
}) {
	return (
		<button class={styles.menuRow} onClick={onClick}>
			<span class={styles.menuRowLabel}>{label}</span>
			<span class={styles.menuRowValue}>{value}</span>
			<span class={styles.menuRowChevron}>
				<Icon name="chevron-right" size={14} />
			</span>
		</button>
	);
}

export function StreamQualityItem({ openPanel }: SettingsMenuApi) {
	return (
		<SubmenuRow
			label="Stream Quality"
			value={QUALITY_NAMES[musicStreamProfile.value] ?? musicStreamProfile.value}
			onClick={() => openPanel('music-quality')}
		/>
	);
}

export function StreamQualityPanel({ openPanel, close }: SettingsMenuApi) {
	return (
		<>
			<button class={styles.menuBack} onClick={() => openPanel('main')}>
				<Icon name="chevron-left" size={14} /> Stream Quality
			</button>
			{qualityOptions().map((o) => (
				<button
					key={o.value}
					class={`${styles.menuItem} ${musicStreamProfile.value === o.value ? styles.selected : ''}`}
					onClick={() => {
						if (musicStreamProfile.value !== o.value) setStreamProfile(o.value);
						close();
					}}
				>
					<span class={styles.menuItemStack}>
						{o.name}
						<span class={styles.menuItemSub}>{o.spec}</span>
					</span>
				</button>
			))}
		</>
	);
}

export function ReplayGainItem({ openPanel }: SettingsMenuApi) {
	return (
		<SubmenuRow
			label="ReplayGain"
			value={REPLAYGAIN_LABELS[musicReplayGain.value] ?? 'Off'}
			onClick={() => openPanel('replaygain')}
		/>
	);
}

export function ReplayGainPanel({ openPanel, close }: SettingsMenuApi) {
	return (
		<>
			<button class={styles.menuBack} onClick={() => openPanel('main')}>
				<Icon name="chevron-left" size={14} /> ReplayGain
			</button>
			{(['off', 'track', 'album'] as ReplayGainMode[]).map((m) => (
				<button
					key={m}
					class={`${styles.menuItem} ${musicReplayGain.value === m ? styles.selected : ''}`}
					onClick={() => {
						setUiSetting(MUSIC_REPLAYGAIN_KEY, m);
						close();
					}}
				>
					{REPLAYGAIN_LABELS[m]}
				</button>
			))}
		</>
	);
}

export function GaplessItem(_: SettingsMenuApi) {
	const on = musicGapless.value;
	return (
		<button class={styles.menuRow} onClick={() => setUiSetting(MUSIC_GAPLESS_KEY, !on)}>
			<span class={styles.menuRowLabel}>Gapless Playback</span>
			<span class={styles.menuRowValue}>{on ? 'On' : 'Off'}</span>
		</button>
	);
}

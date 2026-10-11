import type { VNode } from 'preact';
import { activeAdapter } from '@/state/globalPlayer.state';
import { VIDEO_TOOLBAR } from '@/state/player/adapters/videoAdapter';
import type { StreamSession } from '@/state/player.state';
import { CONTROL_GROUPS, ZONE_GROUPS, ZONED_GROUPS } from './controls/registry';
import type { ControlGroupProps } from './controls/types';
import styles from './PlayerControls.module.scss';

interface PlayerControlsProps {
	visible: boolean;
	onTogglePlay: () => void;
	onSeek: (time: number) => void;
	onToggleFullscreen: () => void;
	onToggleInfo: () => void;
	session: StreamSession | null;
	title?: string;
	/** When true, fullscreen button shows maximize icon instead */
	hasMiniThumbnail?: boolean;
	/** Element rendered to the left of the controls row, below the seek bar */
	leftSlot?: VNode | null;
	/** When true, renders in compact split-panel layout */
	isSplit?: boolean;
	/** When true (shared session + no control permission), play/skip are disabled. */
	playbackLocked?: boolean;
}

/**
 * The player control bar. A thin composer: the active player adapter lists
 * its control groups (see `ControlGroupId`) and this lays them out in the
 * bar's fixed zones — seek row, left title/timing, centre transport, and the
 * right-hand button cluster in list order. Each group lives in `./controls/`.
 */
export function PlayerControls({
	visible,
	onTogglePlay,
	onSeek,
	onToggleFullscreen,
	onToggleInfo,
	session,
	title,
	hasMiniThumbnail,
	leftSlot,
	isSplit,
	playbackLocked = false,
}: PlayerControlsProps) {
	const toolbar = activeAdapter.value?.toolbar ?? VIDEO_TOOLBAR;
	const groupProps: ControlGroupProps = {
		onTogglePlay,
		onSeek,
		onToggleFullscreen,
		onToggleInfo,
		session,
		title,
		hasMiniThumbnail,
		isSplit,
		playbackLocked,
	};
	const has = (id: (typeof toolbar)[number]) => toolbar.includes(id);
	// Each fixed zone renders whichever of its groups the toolbar lists
	// (video: seek/title/transport; audio: waveform/trackTitle/trackTransport).
	const zone = (ids: readonly (typeof toolbar)[number][]) => ids.find(has);
	const seekId = zone(ZONE_GROUPS.seek);
	const titleId = zone(ZONE_GROUPS.title);
	const transportId = zone(ZONE_GROUPS.transport);
	const Seek = seekId ? CONTROL_GROUPS[seekId] : null;
	const Title = titleId ? CONTROL_GROUPS[titleId] : null;
	const Transport = transportId ? CONTROL_GROUPS[transportId] : null;

	return (
		<div
			data-player-panel
			class={`${styles.controls} ${visible ? styles.visible : ''} ${hasMiniThumbnail ? styles.miniMode : ''} ${isSplit ? styles.splitControls : ''} ${seekId === 'waveform' ? styles.waveformMode : ''}`}
		>
			{/* ── Row 1: Seek bar — flush to top, full width ── */}
			<div class={`${styles.seekRow} ${seekId === 'waveform' ? styles.seekRowWaveform : ''}`}>
				{Seek && <Seek {...groupProps} />}
			</div>

			{/* ── Row 2: Content row — optional left slot + controls ── */}
			<div class={styles.contentRow}>
				{leftSlot}
				<div class={styles.mainRow}>
					{/* Left: title + timing (split mode: timing only — title shown above) */}
					{Title && <Title {...groupProps} />}

					{/*
					    Center (transport) + Right (secondary) wrapped in a
					    single .controlsBottomRow. Default `display: contents`
					    keeps this transparent on desktop / portrait; on mobile
					    landscape the wrapper becomes a flex row that puts
					    transport buttons and secondary buttons together as one
					    spread-out row beneath the title row.
					*/}
					<div class={styles.controlsBottomRow}>
						{Transport && <Transport {...groupProps} />}

						{/* Right: plugin buttons + secondary groups, in adapter order */}
						<div class={styles.rightControls}>
							{toolbar
								.filter((id) => !ZONED_GROUPS.has(id))
								.map((id) => {
									const Group = CONTROL_GROUPS[id];
									return <Group key={id} {...groupProps} />;
								})}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

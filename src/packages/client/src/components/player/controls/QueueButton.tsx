import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { MusicListPanel } from '@/components/player/audio/MusicListPanel';
import { QueuePanel } from '@/components/player/QueuePanel';
import { activeKind, playerMode } from '@/state/globalPlayer.state';
import { musicPanelOpen, musicPanelTab } from '@/state/musicPlayer.state';
import { audioQueueCount, hasQueue, queueCount } from '@/state/queue.state';
import styles from '../PlayerControls.module.scss';

/**
 * Audio variant: always shown (the list panel also has Album / Lyrics …).
 * Full mode toggles the side list panel, split jumps it to Up Next, mini
 * opens the list as a flyout.
 */
function AudioQueueButton() {
	const [flyout, setFlyout] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);
	const mode = playerMode.value;
	useEffect(() => {
		if (!flyout) return;
		const onDown = (e: MouseEvent) => {
			if (!wrapRef.current?.contains(e.target as Node)) setFlyout(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [flyout]);
	useEffect(() => {
		if (mode !== 'mini') setFlyout(false);
	}, [mode]);

	const count = audioQueueCount.value;
	const isActive = mode === 'mini' ? flyout : mode === 'full' && musicPanelOpen.value;
	const onClick = () => {
		if (mode === 'mini') setFlyout((v) => !v);
		else if (mode === 'split') musicPanelTab.value = 'upnext';
		else musicPanelOpen.value = !musicPanelOpen.value;
	};
	return (
		<div class={styles.queueBtnWrap} ref={wrapRef}>
			<button
				class={`${styles.controlBtn} ${isActive ? styles.active : ''}`}
				onClick={onClick}
				aria-label={`Up next (${count} queued)`}
				title={`Up next — ${count} queued`}
			>
				<Icon name="view-list" size={20} />
				{count > 0 && <span class={styles.queueBadge}>{count}</span>}
			</button>
			{flyout && (
				<div class={styles.queueFlyout}>
					<MusicListPanel variant="flyout" onClose={() => setFlyout(false)} />
				</div>
			)}
		</div>
	);
}

/**
 * Queue — only surfaced when something is actually queued, so the toolbar
 * stays clean for one-off playback. Opens the queue flyout.
 */
export function QueueButton() {
	if (activeKind.value === 'audio') return <AudioQueueButton />;
	return <VideoQueueButton />;
}

function VideoQueueButton() {
	const [showQueuePanel, setShowQueuePanel] = useState(false);
	const queueRef = useRef<HTMLDivElement>(null);
	// Close the queue flyout on an outside click, matching the settings menu.
	useEffect(() => {
		if (!showQueuePanel) return;
		const onDown = (e: MouseEvent) => {
			if (!queueRef.current?.contains(e.target as Node)) setShowQueuePanel(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [showQueuePanel]);
	// An empty queue can't keep a panel open.
	useEffect(() => {
		if (!hasQueue.value) setShowQueuePanel(false);
	}, [hasQueue.value]);

	if (!hasQueue.value) return null;
	return (
		<div class={styles.queueBtnWrap} ref={queueRef}>
			<button
				class={`${styles.controlBtn} ${showQueuePanel ? styles.active : ''}`}
				onClick={() => setShowQueuePanel((v) => !v)}
				aria-label={`Play queue (${queueCount.value} queued)`}
				title={`Queue — ${queueCount.value} up next`}
			>
				<Icon name="view-list" size={20} />
				<span class={styles.queueBadge}>{queueCount.value}</span>
			</button>
			{showQueuePanel && (
				<div class={styles.queueFlyout}>
					<QueuePanel onClose={() => setShowQueuePanel(false)} />
				</div>
			)}
		</div>
	);
}

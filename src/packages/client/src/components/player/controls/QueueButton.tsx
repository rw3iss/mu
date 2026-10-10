import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { QueuePanel } from '@/components/player/QueuePanel';
import { hasQueue, queueCount } from '@/state/queue.state';
import styles from '../PlayerControls.module.scss';

/**
 * Queue — only surfaced when something is actually queued, so the toolbar
 * stays clean for one-off playback. Opens the queue flyout.
 */
export function QueueButton() {
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

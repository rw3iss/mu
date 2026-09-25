import { useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { playMovie } from '@/state/globalPlayer.state';
import {
	clearQueue,
	moveInQueue,
	playQueue,
	type QueueItem,
	removeFromQueue,
	takeFromQueue,
} from '@/state/queue.state';
import styles from './QueuePanel.module.scss';

interface QueuePanelProps {
	onClose: () => void;
}

/**
 * The play-queue flyout. Index 0 is "up next", so the list reads top-down in
 * play order.
 *
 * Rows mirror the sidebar's "Recent" items (poster, title, year, trailing play
 * button) so the two lists feel like the same component family, with a drag
 * handle and a remove button added.
 */
export function QueuePanel({ onClose }: QueuePanelProps) {
	const items = playQueue.value;
	// Index being dragged, and the row it's currently hovering over. Kept in
	// state (not a ref) so the drop-target row can render its insertion hint.
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);

	const handleDrop = (to: number) => {
		if (dragIndex !== null) moveInQueue(dragIndex, to);
		setDragIndex(null);
		setOverIndex(null);
	};

	/** Play this entry now, discarding everything queued ahead of it. */
	const jumpTo = (item: QueueItem) => {
		const taken = takeFromQueue(item.movieId);
		if (taken) void playMovie(taken.movieId, { fromBeginning: true });
	};

	return (
		<div class={styles.panel}>
			<div class={styles.header}>
				<span class={styles.heading}>
					Queue
					<span class={styles.count}>{items.length}</span>
				</span>
				<div class={styles.headerActions}>
					{items.length > 0 && (
						<button type="button" class={styles.clearBtn} onClick={clearQueue}>
							Clear
						</button>
					)}
					<button
						type="button"
						class={styles.closeBtn}
						onClick={onClose}
						aria-label="Close queue"
					>
						<Icon name="x" size={14} />
					</button>
				</div>
			</div>

			{items.length === 0 ? (
				<p class={styles.empty}>
					Nothing queued. Use <strong>Add to Queue</strong> or <strong>Play Next</strong>{' '}
					from any movie's options menu.
				</p>
			) : (
				<ul class={styles.list}>
					{items.map((item, i) => (
						<li
							key={item.movieId}
							class={`${styles.item} ${dragIndex === i ? styles.dragging : ''} ${
								overIndex === i && dragIndex !== i ? styles.dragOver : ''
							}`}
							draggable
							onDragStart={() => setDragIndex(i)}
							onDragOver={(e) => {
								// Required for the drop to be allowed at all.
								e.preventDefault();
								setOverIndex(i);
							}}
							onDragEnd={() => {
								setDragIndex(null);
								setOverIndex(null);
							}}
							onDrop={(e) => {
								e.preventDefault();
								handleDrop(i);
							}}
						>
							<span class={styles.handle} aria-hidden="true">
								<Icon name="grip" size={12} />
							</span>
							<span class={styles.position}>{i === 0 ? 'Next' : i + 1}</span>

							<div class={styles.poster}>
								{item.posterUrl ? (
									<img src={item.posterUrl} alt={item.title} loading="lazy" />
								) : (
									<div class={styles.posterPlaceholder} />
								)}
							</div>

							<div class={styles.info}>
								<span class={styles.title} title={item.title}>
									{item.title}
								</span>
								{item.year ? <span class={styles.year}>{item.year}</span> : null}
							</div>

							<button
								type="button"
								class={styles.playBtn}
								onClick={() => jumpTo(item)}
								title={`Play "${item.title}" now`}
								aria-label={`Play ${item.title} now`}
							>
								<Icon name="play" size={12} />
							</button>
							<button
								type="button"
								class={styles.removeBtn}
								onClick={() => removeFromQueue(item.movieId)}
								title="Remove from queue"
								aria-label={`Remove ${item.title} from queue`}
							>
								<Icon name="x" size={12} />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

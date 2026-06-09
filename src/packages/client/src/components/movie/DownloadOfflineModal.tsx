import { useCallback, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { streamService } from '@/services/stream.service';
import type { Movie } from '@/state/library.state';
import { notifyError } from '@/state/notifications.state';
import { formatBytes } from '@/utils/format-bytes';
import styles from './DownloadOfflineModal.module.scss';

interface DownloadOfflineModalProps {
	isOpen: boolean;
	movie: Movie;
	onClose: () => void;
}

/**
 * Confirms an offline download of a movie's source file, shows its size, then
 * kicks off a native browser download (resumable, streamed off disk by the
 * server). After the download starts we briefly show a "Downloading…" state
 * and auto-close — the transfer continues in the browser's own manager.
 */
export function DownloadOfflineModal({ isOpen, movie, onClose }: DownloadOfflineModalProps) {
	const [downloading, setDownloading] = useState(false);
	const sizeBytes = movie.fileInfo?.fileSize ?? 0;

	const startDownload = useCallback(() => {
		setDownloading(true);
		try {
			// Trigger a native download via a transient anchor. The server's
			// Content-Disposition sets the "Title (Year).<ext>" filename; the
			// download attribute is just a same-origin hint.
			const url = streamService.getDownloadUrl(movie.id);
			const a = document.createElement('a');
			a.href = url;
			a.download = '';
			a.rel = 'noopener';
			document.body.appendChild(a);
			a.click();
			a.remove();
		} catch {
			notifyError('Could not start the download.');
			setDownloading(false);
			return;
		}
		// Give the browser a beat to pick up the transfer, then close.
		window.setTimeout(() => {
			setDownloading(false);
			onClose();
		}, 1200);
	}, [movie.id, onClose]);

	return (
		<Modal isOpen={isOpen} onClose={downloading ? () => {} : onClose} title="" size="sm">
			<div class={styles.content}>
				{downloading ? (
					<div class={styles.downloadingState}>
						<span class={`${styles.spinner} ${styles.spin}`} aria-hidden="true">
							<Icon name="download" size={28} />
						</span>
						<p class={styles.downloadingText}>Downloading…</p>
						<p class={styles.subtext}>
							Your download has started. You can close this and find it in your
							browser's downloads.
						</p>
					</div>
				) : (
					<>
						<div class={styles.header}>
							<span class={styles.headerIcon} aria-hidden="true">
								<Icon name="download" size={22} />
							</span>
							<div>
								<h3 class={styles.title}>Download for Offline</h3>
								<p class={styles.subtitle}>
									{movie.title}
									{movie.year ? ` (${movie.year})` : ''}
								</p>
							</div>
						</div>
						<p class={styles.message}>
							Save this movie to your device
							{sizeBytes > 0 ? (
								<>
									{' '}
									— <strong>{formatBytes(sizeBytes, 1)}</strong>
								</>
							) : null}
							. The download runs in your browser and can be resumed if it's
							interrupted.
						</p>
						<div class={styles.actions}>
							<Button variant="secondary" onClick={onClose}>
								Cancel
							</Button>
							<Button variant="primary" onClick={startDownload}>
								Download
							</Button>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

import { Icon } from '@/components/common/Icon';
import {
	activeUpload,
	cancelUpload,
	uploadComplete,
	uploadSentBytes,
} from '@/state/upload-progress.state';
import styles from './UploadProgressToast.module.scss';

/**
 * Small floating upload indicator hanging from the top-center of the screen.
 * Shows the uploading movie's name + progress, with a thin progress bar along
 * its bottom edge and a Cancel button. Rendered once at the app root; visible
 * only while an upload is active (see upload-progress.state).
 */
export function UploadProgressToast() {
	const up = activeUpload.value;
	if (!up) return null;

	const sent = uploadSentBytes.value;
	const done = uploadComplete.value;
	const pct = done
		? 100
		: up.totalBytes > 0
			? Math.min(100, Math.round((sent / up.totalBytes) * 100))
			: 0;

	return (
		<div class={styles.wrap}>
			<div class={styles.bar}>
				<Icon name={done ? 'check-circle' : 'upload'} size={16} />
				<span class={styles.title} title={up.rootName}>
					{up.rootName}
				</span>
				<span class={styles.status}>{done ? 'Complete' : `Uploading… ${pct}%`}</span>
				<button
					type="button"
					class={styles.cancel}
					onClick={cancelUpload}
					disabled={done}
					aria-label="Cancel upload"
				>
					Cancel
				</button>
				<div class={styles.progress} style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
}

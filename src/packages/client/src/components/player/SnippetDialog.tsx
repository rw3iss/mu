import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { discardSnippet, downloadSnippet, recordedSnippet } from '@/state/snippet-recorder.state';
import styles from './SnippetDialog.module.scss';

function fmt(s: number): string {
	const m = Math.floor(s / 60);
	return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Preview / download / discard dialog for a recorded snippet. */
export function SnippetDialog() {
	const snippet = recordedSnippet.value;
	if (!snippet) return null;
	return (
		<Modal isOpen onClose={discardSnippet} title="Recorded Snippet" size="md">
			<div class={styles.body}>
				{/* biome-ignore lint/a11y/useMediaCaption: user's own captured clip */}
				<video class={styles.preview} src={snippet.url} controls autoPlay />
				<div class={styles.meta}>
					Length {fmt(snippet.durationSeconds)} ·{' '}
					{(snippet.blob.size / (1024 * 1024)).toFixed(1)} MB · WebM
				</div>
				<div class={styles.actions}>
					<Button variant="ghost" onClick={discardSnippet}>
						Discard
					</Button>
					<Button variant="primary" onClick={downloadSnippet}>
						Download
					</Button>
				</div>
			</div>
		</Modal>
	);
}

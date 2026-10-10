import { isRecordingSnippet, snippetElapsed, stopSnippet } from '@/state/snippet-recorder.state';
import styles from '../PlayerControls.module.scss';

/**
 * Recording indicator — left of Info. Pulses red while recording; on hover
 * becomes a Stop button.
 */
export function SnippetIndicator() {
	if (!isRecordingSnippet.value) return null;
	return (
		<button
			class={`${styles.controlBtn} ${styles.recBtn}`}
			onClick={() => stopSnippet()}
			aria-label="Stop recording"
			title={`Recording ${Math.floor(snippetElapsed.value / 60)}:${String(snippetElapsed.value % 60).padStart(2, '0')} — click to stop`}
		>
			<span class={styles.recDot} />
			<svg
				class={styles.recStop}
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="currentColor"
			>
				<rect x="6" y="6" width="12" height="12" rx="2" />
			</svg>
		</button>
	);
}

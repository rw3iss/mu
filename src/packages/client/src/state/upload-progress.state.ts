import { signal } from '@preact/signals';
import { libraryUploadService } from '@/services/library-upload.service';
import { wsService } from '@/services/websocket.service';
import { notifyError, notifyInfo, notifySuccess } from '@/state/notifications.state';

/**
 * Global "active library upload" state. The upload runs here (not inside the
 * Upload modal) so it survives the modal closing — the modal hands off to
 * `startUpload` and closes, and a small floating widget (UploadProgressToast)
 * tracks progress and offers Cancel. Only one upload runs at a time.
 */

export interface UploadEntry {
	file: File;
	relativePath: string;
}

interface ActiveUpload {
	/** File or root-folder name shown in the widget. */
	rootName: string;
	totalBytes: number;
}

export const activeUpload = signal<ActiveUpload | null>(null);
/** Bytes uploaded so far (monotonic). */
export const uploadSentBytes = signal(0);
/** Brief terminal "complete" flash before the widget auto-dismisses. */
export const uploadComplete = signal(false);

let abortController: AbortController | null = null;
let wsHandler: ((data: unknown) => void) | null = null;

export interface StartUploadArgs {
	sourceId: string;
	entries: UploadEntry[];
	rootName: string;
	onUploaded?: () => void;
}

function teardown(): void {
	if (wsHandler) {
		wsService.off('upload:progress', wsHandler);
		wsHandler = null;
	}
	abortController = null;
	activeUpload.value = null;
	uploadSentBytes.value = 0;
	uploadComplete.value = false;
}

/**
 * Kick off a library upload in the background. Resolves when the upload
 * finishes (or fails/cancels) — callers generally don't await it; they let
 * the floating widget report progress.
 */
export async function startUpload({
	sourceId,
	entries,
	rootName,
	onUploaded,
}: StartUploadArgs): Promise<void> {
	if (activeUpload.value) {
		notifyError('An upload is already in progress — wait for it to finish or cancel it.');
		return;
	}

	const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0);
	activeUpload.value = { rootName, totalBytes };
	uploadSentBytes.value = 0;
	uploadComplete.value = false;

	const uploadId = `up_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
	const controller = new AbortController();
	abortController = controller;
	let base = 0; // bytes of fully-uploaded files so far

	// Server-driven, per-file byte progress over WS (monotonic).
	wsService.subscribe('upload');
	wsHandler = (data: unknown) => {
		const p = data as { uploadId?: string; bytesWritten?: number };
		if (!p || p.uploadId !== uploadId) return;
		uploadSentBytes.value = Math.max(uploadSentBytes.value, base + (p.bytesWritten ?? 0));
	};
	wsService.on('upload:progress', wsHandler);

	try {
		for (const entry of entries) {
			await libraryUploadService.uploadFile({
				sourceId,
				relativePath: entry.relativePath,
				file: entry.file,
				uploadId,
				signal: controller.signal,
				onProgress: (loaded) => {
					uploadSentBytes.value = Math.max(uploadSentBytes.value, base + loaded);
				},
			});
			base += entry.file.size;
			uploadSentBytes.value = base;
		}

		await libraryUploadService.finalize(sourceId, uploadId, rootName);
		uploadComplete.value = true;
		notifySuccess(`Uploaded "${rootName}" — scanning it into the library now.`);
		onUploaded?.();
		// Let the "complete" state show briefly, then dismiss.
		window.setTimeout(teardown, 1500);
	} catch (err) {
		if (controller.signal.aborted) {
			notifyInfo(`Upload of "${rootName}" cancelled.`);
		} else {
			notifyError((err as Error)?.message || 'Upload failed.');
		}
		teardown();
	}
}

/** Cancel the in-flight upload (aborts the current file request). */
export function cancelUpload(): void {
	abortController?.abort();
}

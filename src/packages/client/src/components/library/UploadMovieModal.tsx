import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { libraryUploadService, type UploadTarget } from '@/services/library-upload.service';
import { wsService } from '@/services/websocket.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { formatBytes } from '@/utils/format-bytes';
import styles from './UploadMovieModal.module.scss';

interface UploadMovieModalProps {
	isOpen: boolean;
	onClose: () => void;
	/** Called after a successful upload + scan kickoff (e.g. to refresh). */
	onUploaded?: () => void;
}

/** Mirror of the server's allowed extensions so we don't upload junk files. */
const VIDEO_EXTS = new Set([
	'mkv',
	'mp4',
	'avi',
	'mov',
	'm4v',
	'webm',
	'ts',
	'm2ts',
	'wmv',
	'flv',
	'mpg',
	'mpeg',
]);
const COMPANION_EXTS = new Set([
	'srt',
	'sub',
	'ass',
	'ssa',
	'vtt',
	'idx',
	'nfo',
	'txt',
	'json',
	'jpg',
	'jpeg',
	'png',
	'webp',
]);

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

interface Entry {
	file: File;
	relativePath: string;
}

type Phase = 'select' | 'uploading' | 'done';

export function UploadMovieModal({ isOpen, onClose, onUploaded }: UploadMovieModalProps) {
	const [targets, setTargets] = useState<UploadTarget[]>([]);
	const [sourceId, setSourceId] = useState<string>('');
	const [entries, setEntries] = useState<Entry[]>([]);
	const [rootName, setRootName] = useState<string>('');
	const [phase, setPhase] = useState<Phase>('select');
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState(0); // bytes uploaded so far (aggregate)

	const fileInputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	// Bytes of fully-uploaded files (aggregate base), and the active batch id —
	// refs so the WS progress handler (stable) can read the latest values.
	const baseRef = useRef(0);
	const uploadIdRef = useRef('');

	const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0);

	// Server-driven progress: the server emits upload:progress as it writes each
	// file to disk. Drive the bar from that (monotonic, so it never goes
	// backwards if the browser's own XHR estimate disagrees).
	useEffect(() => {
		if (!isOpen) return;
		wsService.subscribe('upload');
		const onProgress = (data: unknown) => {
			const p = data as { uploadId?: string; bytesWritten?: number };
			if (!p || p.uploadId !== uploadIdRef.current) return;
			const written = p.bytesWritten ?? 0;
			setSent((prev) => Math.max(prev, baseRef.current + written));
		};
		wsService.on('upload:progress', onProgress);
		return () => wsService.off('upload:progress', onProgress);
	}, [isOpen]);

	// Load destinations whenever the modal opens; reset transient state.
	useEffect(() => {
		if (!isOpen) return;
		setEntries([]);
		setRootName('');
		setError(null);
		setPhase('select');
		setSent(0);
		libraryUploadService
			.getTargets()
			.then((r) => {
				setTargets(r.targets);
				// Preselect the default media path (flagged default → first).
				const def = r.targets.find((t) => t.isDefault) ?? r.targets[0];
				setSourceId((prev) => prev || def?.id || '');
			})
			.catch(() => setError('Could not load library destinations.'));
	}, [isOpen]);

	// The folder picker needs the non-standard webkitdirectory attribute.
	useEffect(() => {
		if (folderInputRef.current) {
			folderInputRef.current.setAttribute('webkitdirectory', '');
			folderInputRef.current.setAttribute('directory', '');
		}
	}, []);

	const pickFile = useCallback((files: FileList | null, folder: boolean) => {
		setError(null);
		if (!files || files.length === 0) return;
		const list = Array.from(files);
		if (folder) {
			const allowed = list.filter((f) => {
				const e = extOf(f.name);
				return VIDEO_EXTS.has(e) || COMPANION_EXTS.has(e);
			});
			if (allowed.length === 0) {
				setError(
					'That folder has no movie or companion files (video, subtitles, artwork).',
				);
				return;
			}
			const next = allowed.map((f) => ({
				file: f,
				// webkitRelativePath = "<folder>/.../file"; preserved server-side.
				relativePath:
					(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
			}));
			setEntries(next);
			setRootName(next[0]!.relativePath.split('/')[0] || next[0]!.file.name);
		} else {
			const f = list[0]!;
			if (!VIDEO_EXTS.has(extOf(f.name))) {
				setError('Only movie files can be uploaded individually (e.g. .mkv, .mp4).');
				return;
			}
			setEntries([{ file: f, relativePath: f.name }]);
			setRootName(f.name);
		}
	}, []);

	const canUpload = entries.length > 0 && !!sourceId && phase === 'select';

	const handleUpload = useCallback(async () => {
		if (!canUpload) return;
		setError(null);
		setPhase('uploading');
		setSent(0);
		const uploadId = `up_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
		uploadIdRef.current = uploadId;
		baseRef.current = 0;
		const controller = new AbortController();
		abortRef.current = controller;

		try {
			// Conflict pre-check on the top-level name (file or root folder).
			const { conflicts } = await libraryUploadService.preflight(sourceId, [rootName]);
			if (conflicts.length > 0) {
				throw new Error(`Already exists in the library: ${conflicts.join(', ')}`);
			}

			for (const entry of entries) {
				await libraryUploadService.uploadFile({
					sourceId,
					relativePath: entry.relativePath,
					file: entry.file,
					uploadId,
					signal: controller.signal,
					// Browser-side estimate as a fallback; monotonic so it never
					// fights the server's WS progress.
					onProgress: (loaded) =>
						setSent((prev) => Math.max(prev, baseRef.current + loaded)),
				});
				baseRef.current += entry.file.size;
				setSent(baseRef.current);
			}

			await libraryUploadService.finalize(sourceId, uploadId, rootName);
			setPhase('done');
			notifySuccess(`Uploaded "${rootName}" — scanning it into the library now.`);
			onUploaded?.();
			window.setTimeout(() => onClose(), 1200);
		} catch (err) {
			const msg = (err as Error)?.message || 'Upload failed.';
			setError(msg);
			notifyError(msg);
			setPhase('select');
		} finally {
			abortRef.current = null;
		}
	}, [canUpload, sourceId, entries, rootName, onClose, onUploaded]);

	const handleClose = useCallback(() => {
		// Uploads continue in the background if closed mid-flight (per the copy);
		// we just stop showing progress. Selecting again starts fresh.
		onClose();
	}, [onClose]);

	const pct = totalBytes > 0 ? Math.min(100, Math.round((sent / totalBytes) * 100)) : 0;

	return (
		<Modal isOpen={isOpen} onClose={handleClose} title="Upload to Library" size="md">
			<div class={styles.content}>
				{phase === 'uploading' || phase === 'done' ? (
					<div class={styles.uploading}>
						<div class={styles.uploadingHead}>
							{phase === 'done' ? (
								<Icon name="check-circle" size={22} />
							) : (
								<Spinner size="sm" />
							)}
							<span>{phase === 'done' ? 'Upload complete' : 'Uploading…'}</span>
						</div>
						<div class={styles.progressTrack}>
							<div class={styles.progressFill} style={{ width: `${pct}%` }} />
						</div>
						<div class={styles.progressMeta}>
							<span>
								{formatBytes(sent, 1)} / {formatBytes(totalBytes, 1)}
							</span>
							<span>{pct}%</span>
						</div>
						<p class={styles.subtext}>
							{phase === 'done'
								? 'The movie is being scanned into your library.'
								: 'You can close this window — the upload continues in the background.'}
						</p>
						{error && <p class={styles.error}>{error}</p>}
					</div>
				) : (
					<>
						<p class={styles.blurb}>
							Upload a movie file, or a whole movie folder (with subtitles/artwork),
							straight onto the server's library. It'll be scanned in automatically.
						</p>

						{targets.length > 1 && (
							<label class={styles.field}>
								<span class={styles.fieldLabel}>Library destination</span>
								<select
									class={styles.select}
									value={sourceId}
									onChange={(e) =>
										setSourceId((e.target as HTMLSelectElement).value)
									}
								>
									{targets.map((t) => (
										<option key={t.id} value={t.id}>
											{t.path}
											{t.label ? ` (${t.label})` : ''}
										</option>
									))}
								</select>
							</label>
						)}

						<div class={styles.pickers}>
							<Button
								variant="secondary"
								onClick={() => fileInputRef.current?.click()}
							>
								<Icon name="film" size={16} /> Choose file
							</Button>
							<Button
								variant="secondary"
								onClick={() => folderInputRef.current?.click()}
							>
								<Icon name="list-plus" size={16} /> Choose folder
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								accept="video/*,.mkv,.avi,.m2ts,.ts"
								class={styles.hiddenInput}
								onChange={(e) =>
									pickFile((e.target as HTMLInputElement).files, false)
								}
							/>
							<input
								ref={folderInputRef}
								type="file"
								multiple
								class={styles.hiddenInput}
								onChange={(e) =>
									pickFile((e.target as HTMLInputElement).files, true)
								}
							/>
						</div>

						{entries.length > 0 && (
							<div class={styles.fileList}>
								<div class={styles.fileListHead}>
									<span>
										{rootName}
										{entries.length > 1 ? ` · ${entries.length} files` : ''}
									</span>
								</div>
								<ul class={styles.files}>
									{entries.slice(0, 50).map((e) => (
										<li key={e.relativePath} class={styles.fileRow}>
											<span class={styles.fileName}>{e.relativePath}</span>
											<span class={styles.fileSize}>
												{formatBytes(e.file.size, 1)}
											</span>
										</li>
									))}
									{entries.length > 50 && (
										<li class={styles.fileRow}>
											<span class={styles.fileName}>
												…and {entries.length - 50} more
											</span>
										</li>
									)}
								</ul>
								<div class={styles.totalRow}>
									<span>Total</span>
									<strong>{formatBytes(totalBytes, 2)}</strong>
								</div>
							</div>
						)}

						{error && <p class={styles.error}>{error}</p>}

						<div class={styles.actions}>
							<Button variant="ghost" onClick={handleClose}>
								Cancel
							</Button>
							<Button variant="primary" disabled={!canUpload} onClick={handleUpload}>
								Upload
							</Button>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

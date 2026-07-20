import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { libraryUploadService, type UploadTarget } from '@/services/library-upload.service';
import { startUpload } from '@/state/upload-progress.state';
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

// ── Drag-and-drop folder support ─────────────────────────────────────────
// Dropping a folder only exposes its contents through the FileSystem Entry
// API (webkitGetAsEntry) — `DataTransfer.files` gives just the folder shell.
// We walk directory entries recursively to collect every file with its
// folder-relative path (mirroring the pickers' webkitRelativePath).

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
	return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
	return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walkDir(dir: FileSystemDirectoryEntry, prefix: string, out: Entry[]): Promise<void> {
	const reader = dir.createReader();
	// readEntries returns the directory in batches — keep reading until empty.
	let batch = await readEntries(reader);
	while (batch.length > 0) {
		for (const child of batch) {
			if (child.isFile) {
				const file = await entryToFile(child as FileSystemFileEntry);
				out.push({ file, relativePath: `${prefix}/${file.name}` });
			} else if (child.isDirectory) {
				await walkDir(child as FileSystemDirectoryEntry, `${prefix}/${child.name}`, out);
			}
		}
		batch = await readEntries(reader);
	}
}

/** Collect files from one dropped top-level entry (a file or a folder). */
async function collectEntry(entry: FileSystemEntry, out: Entry[]): Promise<void> {
	if (entry.isFile) {
		const file = await entryToFile(entry as FileSystemFileEntry);
		out.push({ file, relativePath: file.name });
	} else if (entry.isDirectory) {
		await walkDir(entry as FileSystemDirectoryEntry, entry.name, out);
	}
}

export function UploadMovieModal({ isOpen, onClose, onUploaded }: UploadMovieModalProps) {
	const [targets, setTargets] = useState<UploadTarget[]>([]);
	const [sourceId, setSourceId] = useState<string>('');
	const [entries, setEntries] = useState<Entry[]>([]);
	const [rootName, setRootName] = useState<string>('');
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);

	const fileInputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);

	const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0);

	// Load destinations whenever the modal opens; reset transient state.
	useEffect(() => {
		if (!isOpen) return;
		setEntries([]);
		setRootName('');
		setError(null);
		setStarting(false);
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

	const [dragging, setDragging] = useState(false);
	const dragDepth = useRef(0);

	// Stage a collected set of files as either a single movie file or a movie
	// folder (with companions). Shared by the file/folder pickers and drop.
	const ingest = useCallback((collected: Entry[], folder: boolean) => {
		setError(null);
		if (collected.length === 0) return;
		if (folder) {
			const allowed = collected.filter((e) => {
				const ext = extOf(e.file.name);
				return VIDEO_EXTS.has(ext) || COMPANION_EXTS.has(ext);
			});
			if (allowed.length === 0) {
				setError(
					'That folder has no movie or companion files (video, subtitles, artwork).',
				);
				return;
			}
			setEntries(allowed);
			setRootName(allowed[0]!.relativePath.split('/')[0] || allowed[0]!.file.name);
		} else {
			const f = collected[0]!;
			if (!VIDEO_EXTS.has(extOf(f.file.name))) {
				setError('Only movie files can be uploaded individually (e.g. .mkv, .mp4).');
				return;
			}
			setEntries([{ file: f.file, relativePath: f.file.name }]);
			setRootName(f.file.name);
		}
	}, []);

	const pickFile = useCallback(
		(files: FileList | null, folder: boolean) => {
			if (!files || files.length === 0) return;
			const collected = Array.from(files).map((f) => ({
				file: f,
				// webkitRelativePath = "<folder>/.../file"; preserved server-side.
				relativePath:
					(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
			}));
			ingest(collected, folder);
		},
		[ingest],
	);

	const handleDragEnter = useCallback((e: DragEvent) => {
		e.preventDefault();
		dragDepth.current += 1;
		setDragging(true);
	}, []);

	const handleDragOver = useCallback((e: DragEvent) => {
		// Required, otherwise the browser never fires `drop`.
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		e.preventDefault();
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) setDragging(false);
	}, []);

	const handleDrop = useCallback(
		async (e: DragEvent) => {
			e.preventDefault();
			dragDepth.current = 0;
			setDragging(false);
			const dt = e.dataTransfer;
			if (!dt) return;
			// webkitGetAsEntry() must be read SYNCHRONOUSLY — the items list is
			// only valid during the event, before any await.
			const roots: FileSystemEntry[] = [];
			if (dt.items?.length) {
				for (const item of Array.from(dt.items)) {
					const entry = item.webkitGetAsEntry?.();
					if (entry) roots.push(entry);
				}
			}
			if (roots.length > 0) {
				const collected: Entry[] = [];
				// Folder mode when any dropped item is a directory (companions
				// allowed); otherwise it's plain file(s).
				let sawDir = false;
				for (const entry of roots) {
					if (entry.isDirectory) sawDir = true;
					try {
						await collectEntry(entry, collected);
					} catch {
						// Skip an unreadable entry rather than failing the whole drop.
					}
				}
				ingest(collected, sawDir);
				return;
			}
			// Fallback: entry API unavailable — plain files only (no folders).
			if (dt.files?.length) pickFile(dt.files, false);
		},
		[ingest, pickFile],
	);

	const canUpload = entries.length > 0 && !!sourceId && !starting;

	const handleUpload = useCallback(async () => {
		if (entries.length === 0 || !sourceId || starting) return;
		setError(null);
		setStarting(true);
		try {
			// Conflict pre-check on the top-level name (file or root folder) —
			// keep the modal open to show the error if it already exists.
			const { conflicts } = await libraryUploadService.preflight(sourceId, [rootName]);
			if (conflicts.length > 0) {
				setError(`Already exists in the library: ${conflicts.join(', ')}`);
				setStarting(false);
				return;
			}
		} catch (err) {
			setError((err as Error)?.message || 'Could not start the upload.');
			setStarting(false);
			return;
		}
		// Hand the upload off to the global floating widget, then close so the
		// user gets their screen back while it uploads in the background.
		void startUpload({ sourceId, entries, rootName, onUploaded });
		onClose();
	}, [entries, sourceId, rootName, starting, onClose, onUploaded]);

	const handleClose = useCallback(() => {
		onClose();
	}, [onClose]);

	return (
		<Modal isOpen={isOpen} onClose={handleClose} title="Upload to Library" size="md">
			<div
				class={styles.content}
				onDragEnter={handleDragEnter}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
			>
				<p class={styles.blurb}>
					Upload a movie file, or a whole movie folder (with subtitles/artwork), straight
					onto the server's library. It'll be scanned in automatically.
				</p>

				{targets.length > 1 && (
					<label class={styles.field}>
						<span class={styles.fieldLabel}>Library destination</span>
						<select
							class={styles.select}
							value={sourceId}
							onChange={(e) => setSourceId((e.target as HTMLSelectElement).value)}
						>
							{targets.map((t) => (
								<option key={t.id} value={t.id}>
									{t.label ? `${t.label} — ` : ''}
									{t.path}
									{t.isDefault ? ' (default)' : ''}
								</option>
							))}
						</select>
					</label>
				)}

				<div class={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ''}`}>
					<Icon name="upload" size={24} />
					<p class={styles.dropHint}>Drag a movie file or folder here, or</p>
					<div class={styles.pickers}>
						<Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
							<Icon name="film" size={16} /> Choose file
						</Button>
						<Button variant="secondary" onClick={() => folderInputRef.current?.click()}>
							<Icon name="list-plus" size={16} /> Choose folder
						</Button>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept="video/*,.mkv,.avi,.m2ts,.ts"
						class={styles.hiddenInput}
						onChange={(e) => pickFile((e.target as HTMLInputElement).files, false)}
					/>
					<input
						ref={folderInputRef}
						type="file"
						multiple
						class={styles.hiddenInput}
						onChange={(e) => pickFile((e.target as HTMLInputElement).files, true)}
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
						{starting ? 'Starting…' : 'Upload'}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

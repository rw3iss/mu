import { SUPPORTED_AUDIO_EXTENSIONS } from '@mu/shared';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { collectEntry, type Entry } from '@/components/library/UploadMovieModal';
import styles from '@/components/library/UploadMovieModal.module.scss';
import { musicUploadService, type UploadTarget } from '@/services/library-upload.service';
import { can } from '@/state/auth.state';
import { startUpload } from '@/state/upload-progress.state';
import { formatBytes } from '@/utils/format-bytes';

/** Mirror of the server's allowed extensions (music/upload/upload-paths.ts). */
const AUDIO_EXTS = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS);
const COMPANION_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'cue', 'lrc']);

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** Extension for an audio MIME type — some mobile pickers hand over names without one. */
const EXT_BY_MIME: Record<string, string> = {
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/flac': 'flac',
	'audio/x-flac': 'flac',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/aac': 'aac',
	'audio/ogg': 'ogg',
	'audio/opus': 'opus',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/aiff': 'aiff',
	'audio/x-aiff': 'aiff',
	'application/zip': 'zip',
	'application/x-zip-compressed': 'zip',
};

/** Give extension-less audio files an extension from their MIME type. */
function withExtension(e: Entry): Entry {
	const ext = extOf(e.file.name);
	if (AUDIO_EXTS.has(ext) || COMPANION_EXTS.has(ext) || ext === 'zip') return e;
	const guess = EXT_BY_MIME[e.file.type];
	return guess ? { ...e, relativePath: `${e.relativePath}.${guess}` } : e;
}

/**
 * Folder picking (`webkitdirectory`) only works in desktop browsers. Phones
 * (iOS Safari, Android Chrome) ignore it and open the plain file picker, so
 * the button is hidden there and the user picks tracks or a .zip instead.
 */
const canPickFolders = (() => {
	if (typeof document === 'undefined' || typeof navigator === 'undefined') return false;
	const mobile =
		/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
		(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
	return !mobile && 'webkitdirectory' in document.createElement('input');
})();

/**
 * Top-level files may be audio tracks (placed by their tags as
 * `<Artist>/<Album>/<file>`) or `.zip` archives; files inside a folder may
 * also be art / `.cue` / `.lrc`.
 */
function filterEntries(collected: Entry[]): Entry[] {
	return collected.filter((e) => {
		const ext = extOf(e.relativePath);
		const nested = e.relativePath.includes('/');
		if (nested) return AUDIO_EXTS.has(ext) || COMPANION_EXTS.has(ext);
		return AUDIO_EXTS.has(ext) || ext === 'zip';
	});
}

interface MusicUploadModalProps {
	isOpen: boolean;
	onClose: () => void;
}

/**
 * Upload music: tracks, a folder (album / artist tree), or `.zip` archives.
 * Same background upload pipeline as the movie upload (floating progress
 * widget); the server imports only what was written.
 */
export function MusicUploadModal({ isOpen, onClose }: MusicUploadModalProps) {
	const [targets, setTargets] = useState<UploadTarget[]>([]);
	const [sourceId, setSourceId] = useState('');
	const [entries, setEntries] = useState<Entry[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const [dragging, setDragging] = useState(false);
	/** True once targets loaded and there is no music folder to upload into. */
	const [noTargets, setNoTargets] = useState(false);
	const dragDepth = useRef(0);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!isOpen) return;
		setEntries([]);
		setError(null);
		setStarting(false);
		setNoTargets(false);
		musicUploadService
			.getTargets()
			.then((r) => {
				setTargets(r.targets);
				const def = r.targets.find((t) => t.isDefault) ?? r.targets[0];
				setSourceId((prev) => prev || def?.id || '');
				setNoTargets(r.targets.length === 0);
			})
			.catch(() => setError('Could not load music folders.'));
	}, [isOpen]);

	useEffect(() => {
		folderInputRef.current?.setAttribute('webkitdirectory', '');
		folderInputRef.current?.setAttribute('directory', '');
	}, [isOpen]);

	const ingest = useCallback((collected: Entry[]) => {
		setError(null);
		if (collected.length === 0) return;
		const allowed = filterEntries(collected.map(withExtension));
		if (allowed.length === 0) {
			setError('Nothing to upload — choose audio files, a music folder, or a .zip.');
			return;
		}
		setEntries((prev) => {
			const seen = new Set(prev.map((e) => e.relativePath));
			return [...prev, ...allowed.filter((e) => !seen.has(e.relativePath))];
		});
	}, []);

	const pick = useCallback(
		(files: FileList | null) => {
			if (!files?.length) return;
			ingest(
				Array.from(files).map((f) => ({
					file: f,
					relativePath:
						(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
				})),
			);
		},
		[ingest],
	);

	const handleDrop = useCallback(
		async (e: DragEvent) => {
			e.preventDefault();
			dragDepth.current = 0;
			setDragging(false);
			const dt = e.dataTransfer;
			if (!dt) return;
			const roots: FileSystemEntry[] = [];
			for (const item of Array.from(dt.items ?? [])) {
				const entry = item.webkitGetAsEntry?.();
				if (entry) roots.push(entry);
			}
			if (roots.length === 0) {
				pick(dt.files);
				return;
			}
			const collected: Entry[] = [];
			for (const entry of roots) {
				try {
					await collectEntry(entry, collected);
				} catch {
					// Skip unreadable entries.
				}
			}
			ingest(collected);
		},
		[ingest, pick],
	);

	const totalBytes = entries.reduce((s, e) => s + e.file.size, 0);
	const roots = [...new Set(entries.map((e) => e.relativePath.split('/')[0]!))];
	const rootName = roots.length === 1 ? roots[0]! : `${roots.length} items`;
	const canUpload = entries.length > 0 && !!sourceId && !starting;

	const handleUpload = useCallback(async () => {
		if (!canUpload) return;
		setError(null);
		setStarting(true);
		// Only folder roots can collide up front; loose tracks are placed by
		// their tags server-side (409 per file), zips never overwrite.
		const folderRoots = roots.filter((r) =>
			entries.some((e) => e.relativePath.startsWith(`${r}/`)),
		);
		if (folderRoots.length) {
			try {
				const { conflicts } = await musicUploadService.preflight(sourceId, folderRoots);
				if (conflicts.length) {
					setError(`Already in the music folder: ${conflicts.join(', ')}`);
					setStarting(false);
					return;
				}
			} catch (err) {
				setError((err as Error)?.message || 'Could not start the upload.');
				setStarting(false);
				return;
			}
		}
		void startUpload({
			sourceId,
			entries,
			rootName,
			service: musicUploadService,
			successMessage: `Uploaded "${rootName}" — importing it into your music library now.`,
		});
		onClose();
	}, [canUpload, entries, roots, rootName, sourceId, onClose]);

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Upload Music" size="md">
			<div
				class={styles.content}
				onDragEnter={(e: DragEvent) => {
					e.preventDefault();
					dragDepth.current += 1;
					setDragging(true);
				}}
				onDragOver={(e: DragEvent) => {
					e.preventDefault();
					if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
				}}
				onDragLeave={(e: DragEvent) => {
					e.preventDefault();
					dragDepth.current = Math.max(0, dragDepth.current - 1);
					if (dragDepth.current === 0) setDragging(false);
				}}
				onDrop={handleDrop}
			>
				<p class={styles.blurb}>
					Upload tracks, an album or artist folder, or a .zip. Loose tracks are filed as
					Artist / Album from their tags; folders keep their structure. Art, .cue and .lrc
					files inside folders come along.
				</p>

				{noTargets && (
					<p class={styles.error}>
						No music folder is set up yet, so uploads have nowhere to go.{' '}
						{can('admin:server')
							? 'Add one in Settings → Music → Music Folders, then try again.'
							: 'Ask an admin to add a music folder in Settings → Music.'}
					</p>
				)}

				{targets.length > 1 && (
					<label class={styles.field}>
						<span class={styles.fieldLabel}>Music folder</span>
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
					<p class={styles.dropHint}>
						{canPickFolders
							? 'Drag tracks, folders or a .zip here, or'
							: 'Choose tracks (select several at once) or a .zip of a folder'}
					</p>
					<div class={styles.pickers}>
						<Button
							variant="secondary"
							disabled={noTargets}
							onClick={() => fileInputRef.current?.click()}
						>
							<Icon name="music" size={16} /> Choose files
						</Button>
						{canPickFolders && (
							<Button
								variant="secondary"
								disabled={noTargets}
								onClick={() => folderInputRef.current?.click()}
							>
								<Icon name="list-plus" size={16} /> Choose folder
							</Button>
						)}
					</div>
					{!canPickFolders && (
						<p class={styles.dropHint}>
							Phones can't pick folders. To upload a whole album, zip the folder
							first, or upload from a computer.
						</p>
					)}
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept={`audio/*,.zip,${[...AUDIO_EXTS].map((x) => `.${x}`).join(',')}`}
						class={styles.hiddenInput}
						onChange={(e) => pick((e.target as HTMLInputElement).files)}
					/>
					<input
						ref={folderInputRef}
						type="file"
						multiple
						class={styles.hiddenInput}
						onChange={(e) => pick((e.target as HTMLInputElement).files)}
					/>
				</div>

				{entries.length > 0 && (
					<div class={styles.fileList}>
						<div class={styles.fileListHead}>
							<span>
								{rootName}
								{entries.length > 1 ? ` · ${entries.length} files` : ''}
							</span>
							<Button variant="ghost" size="sm" onClick={() => setEntries([])}>
								Clear
							</Button>
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
					<Button variant="ghost" onClick={onClose}>
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

/** Header button + modal; renders nothing without `edit:media`. */
export function MusicUploadButton({ class: className }: { class?: string }) {
	const [open, setOpen] = useState(false);
	if (!can('edit:media')) return null;
	return (
		<>
			<Button
				variant="secondary"
				size="sm"
				class={className}
				onClick={() => setOpen(true)}
				aria-label="Upload music"
			>
				<Icon name="upload" size={16} /> Upload
			</Button>
			<MusicUploadModal isOpen={open} onClose={() => setOpen(false)} />
		</>
	);
}

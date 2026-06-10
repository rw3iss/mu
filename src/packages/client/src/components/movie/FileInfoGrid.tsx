import { useCallback, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { streamService } from '@/services/stream.service';
import { currentUser } from '@/state/auth.state';
import type { Movie } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { formatBytes } from '@/utils/format-bytes';
import { clockFromSeconds, relativeTime } from '@/utils/time-format';
import styles from './FileInfoGrid.module.scss';

interface FileInfoGridProps {
	movie: Movie;
	/** Called after a cached version is deleted so parent can refresh */
	onCacheDeleted?: () => void;
	/** Use dark-on-dark palette for player flyout panels */
	dark?: boolean;
}

/** Tiny copy-to-clipboard button: copy icon → green check for 2s. */
function CopyBtn({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	const copy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* clipboard unavailable */
		}
	}, [text]);
	return (
		<button
			type="button"
			class={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
			onClick={copy}
			title={copied ? 'Copied!' : label}
			aria-label={label}
		>
			<Icon name={copied ? 'check' : 'copy'} size={12} />
		</button>
	);
}

export function FileInfoGrid({ movie, onCacheDeleted, dark }: FileInfoGridProps) {
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const isAdmin = currentUser.value?.role === 'admin';

	const handleDeleteCache = async (quality: string) => {
		setDeleting(true);
		try {
			await streamService.deleteCachedVersion(movie.id, quality);
			notifySuccess(`Deleted cached ${quality.toUpperCase()} version`);
			setConfirmDelete(null);
			onCacheDeleted?.();
		} catch {
			notifyError('Failed to delete cached version');
		} finally {
			setDeleting(false);
		}
	};
	const fi = movie.fileInfo;
	if (!fi) return null;

	const wrapClass = dark ? `${styles.wrap} ${styles.dark}` : styles.wrap;

	return (
		<div class={wrapClass}>
			<div class={styles.groups}>
				{/* ── General ── */}
				<div class={styles.group}>
					<h4 class={styles.groupTitle}>General</h4>
					<div class={styles.grid}>
						{(() => {
							const unprobed = !fi.codecVideo;
							const cached = (movie as any).cachedVersions as unknown[] | undefined;
							const transcoded = !!cached && cached.length > 0;
							if (!unprobed && !transcoded) return null;
							return (
								<>
									<span class={styles.label}>Status</span>
									<span class={styles.value}>
										{unprobed ? (
											<span
												class={`${styles.statusBadge} ${styles.statusPending}`}
											>
												Not yet probed — codec will be checked
											</span>
										) : (
											<span
												class={`${styles.statusBadge} ${styles.statusTranscoded}`}
											>
												Transcoded · {cached!.length} cached version
												{cached!.length > 1 ? 's' : ''}
											</span>
										)}
									</span>
								</>
							);
						})()}
						{fi.filePath && (
							<>
								<span class={styles.label}>Location</span>
								<span class={styles.value}>
									{fi.filePath.replace(/[\\/][^\\/]*$/, '')}
								</span>
							</>
						)}
						{fi.fileName && (
							<>
								<span class={styles.label}>File</span>
								<span class={styles.value}>{fi.fileName}</span>
							</>
						)}
						{fi.containerFormat && (
							<>
								<span class={styles.label}>Container</span>
								<span class={styles.value}>{fi.containerFormat}</span>
							</>
						)}
						{fi.fileSize != null && fi.fileSize > 0 && (
							<>
								<span class={styles.label}>File Size</span>
								<span class={styles.value}>{formatBytes(fi.fileSize, 2)}</span>
							</>
						)}
						{movie.durationSeconds != null && movie.durationSeconds > 0 && (
							<>
								<span class={styles.label}>Duration</span>
								<span class={styles.value}>
									{clockFromSeconds(movie.durationSeconds)}
								</span>
							</>
						)}
						{movie.addedAt && (
							<>
								<span class={styles.label}>Added</span>
								<span
									class={styles.value}
									title={new Date(movie.addedAt).toLocaleString()}
								>
									{new Date(movie.addedAt).toLocaleDateString()} (
									{relativeTime(movie.addedAt)})
								</span>
							</>
						)}
					</div>
				</div>

				{/* ── Video ── */}
				<div class={styles.group}>
					<h4 class={styles.groupTitle}>Video</h4>
					<div class={styles.grid}>
						{(fi.videoWidth || fi.resolution) && (
							<>
								<span class={styles.label}>Resolution</span>
								<span class={styles.value}>
									{fi.videoWidth && fi.videoHeight
										? `${fi.videoWidth}x${fi.videoHeight}`
										: ''}{' '}
									{fi.resolution ? `(${fi.resolution})` : ''}
								</span>
							</>
						)}
						{fi.codecVideo && (
							<>
								<span class={styles.label}>Codec</span>
								<span class={styles.value}>
									{fi.codecVideo.toUpperCase()}
									{fi.videoProfile ? ` ${fi.videoProfile}` : ''}
								</span>
							</>
						)}
						{fi.videoBitDepth && (
							<>
								<span class={styles.label}>Bit Depth</span>
								<span class={styles.value}>
									{fi.videoBitDepth}-bit
									{fi.hdr && <span class={styles.badge}>HDR</span>}
								</span>
							</>
						)}
						{fi.videoFrameRate && (
							<>
								<span class={styles.label}>Frame Rate</span>
								<span class={styles.value}>
									{parseFloat(fi.videoFrameRate).toFixed(
										Number.isInteger(parseFloat(fi.videoFrameRate)) ? 0 : 3,
									)}{' '}
									fps
								</span>
							</>
						)}
						{fi.bitrate != null && fi.bitrate > 0 && (
							<>
								<span class={styles.label}>Bitrate</span>
								<span class={styles.value}>
									{(fi.bitrate / 1_000_000).toFixed(1)} Mbps
								</span>
							</>
						)}
						{fi.videoColorSpace && (
							<>
								<span class={styles.label}>Color Space</span>
								<span class={styles.value}>{fi.videoColorSpace}</span>
							</>
						)}
					</div>
				</div>

				{/* ── Audio ── */}
				<div class={styles.group}>
					<h4 class={styles.groupTitle}>Audio</h4>
					<div class={styles.grid}>
						{fi.codecAudio && (
							<>
								<span class={styles.label}>Codec</span>
								<span class={styles.value}>{fi.codecAudio.toUpperCase()}</span>
							</>
						)}
						{fi.audioTracks && fi.audioTracks.length > 0 && (
							<>
								<span class={styles.label}>
									Audio Tracks ({fi.audioTracks.length})
								</span>
								<span class={styles.value}>
									<div class={styles.trackList}>
										{fi.audioTracks.map((t) => (
											<div key={t.index} class={styles.trackItem}>
												<span class={styles.trackCodec}>
													{t.codec.toUpperCase()}
												</span>
												<span class={styles.trackMeta}>
													{t.channelLayout ||
														(t.channels ? `${t.channels}ch` : '')}
												</span>
												<span class={styles.trackLang}>
													{t.language !== 'und'
														? t.language?.toUpperCase()
														: ''}
												</span>
												{t.title && t.title !== `Track ${t.index + 1}` && (
													<span class={styles.trackExtra}>{t.title}</span>
												)}
											</div>
										))}
									</div>
								</span>
							</>
						)}
					</div>
				</div>

				{/* ── Cached versions ── */}
				{(movie as any).cachedVersions?.length > 0 && (
					<div class={styles.group}>
						<h4 class={styles.groupTitle}>
							Cached Versions ({(movie as any).cachedVersions.length})
						</h4>
						<div class={styles.trackList}>
							{(movie as any).cachedVersions.map(
								(v: {
									quality: string;
									completedAt: string;
									sizeBytes?: number | null;
								}) => (
									<div key={v.quality} class={styles.trackItem}>
										<span class={styles.trackCodec}>
											{v.quality.toUpperCase()}
										</span>
										{v.sizeBytes != null && v.sizeBytes > 0 && (
											<span class={styles.trackMeta}>
												{formatBytes(v.sizeBytes, 2)}
											</span>
										)}
										<span class={styles.trackMeta}>
											{new Date(v.completedAt).toLocaleDateString()}
										</span>
										{isAdmin &&
											(confirmDelete === v.quality ? (
												<span style={{ display: 'flex', gap: '4px' }}>
													<button
														class={styles.trackDeleteBtn}
														style={{ color: 'var(--color-error)' }}
														disabled={deleting}
														onClick={() => handleDeleteCache(v.quality)}
													>
														{deleting ? '...' : 'Confirm'}
													</button>
													<button
														class={styles.trackDeleteBtn}
														onClick={() => setConfirmDelete(null)}
													>
														Cancel
													</button>
												</span>
											) : (
												<button
													class={styles.trackDeleteBtn}
													onClick={() => setConfirmDelete(v.quality)}
												>
													Delete
												</button>
											))}
									</div>
								),
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

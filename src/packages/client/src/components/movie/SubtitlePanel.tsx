import type { MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import { useCallback, useRef, useState } from 'preact/hooks';
import { subtitlesService } from '@/services/subtitles.service';
import styles from './SubtitlePanel.module.scss';

interface SubtitlePanelProps {
	movieId: string;
	/** Pre-loaded subtitle tracks (from movie file info) */
	existingTracks?: MovieSubtitleInfo[];
	/** Called when a subtitle is selected for playback */
	onSelect?: (track: MovieSubtitleInfo) => void;
	/** Called when subtitles change (download/upload) so parent can refresh */
	onSubtitlesChanged?: () => void;
}

export function SubtitlePanel({
	movieId,
	existingTracks,
	onSelect,
	onSubtitlesChanged,
}: SubtitlePanelProps) {
	const [tracks, setTracks] = useState<MovieSubtitleInfo[]>(existingTracks ?? []);
	const [tracksOpen, setTracksOpen] = useState(true);
	const [searchResults, setSearchResults] = useState<SubtitleSearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [searchDone, setSearchDone] = useState(false);
	const [downloadingId, setDownloadingId] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const refreshTracks = useCallback(async () => {
		try {
			const { subtitles } = await subtitlesService.list(movieId);
			setTracks(subtitles);
			onSubtitlesChanged?.();
		} catch {
			// Silently fail
		}
	}, [movieId, onSubtitlesChanged]);

	const handleSearch = useCallback(async () => {
		setIsSearching(true);
		setError(null);
		setSearchResults([]);
		try {
			const { results } = await subtitlesService.search(movieId);
			setSearchResults(results);
			setSearchDone(true);
		} catch (err: any) {
			setError(err.message || 'Search failed');
		} finally {
			setIsSearching(false);
		}
	}, [movieId]);

	const handleDownload = useCallback(
		async (result: SubtitleSearchResult) => {
			setDownloadingId(result.fileId);
			setError(null);
			try {
				await subtitlesService.download(
					movieId,
					result.provider,
					result.fileId,
					result.language,
				);
				await refreshTracks();
			} catch (err: any) {
				setError(err.message || 'Download failed');
			} finally {
				setDownloadingId(null);
			}
		},
		[movieId, refreshTracks],
	);

	const handleUpload = useCallback(
		async (e: Event) => {
			const input = e.target as HTMLInputElement;
			const file = input.files?.[0];
			if (!file) return;

			setIsUploading(true);
			setError(null);
			try {
				await subtitlesService.upload(movieId, file);
				await refreshTracks();
			} catch (err: any) {
				setError(err.message || 'Upload failed');
			} finally {
				setIsUploading(false);
				input.value = '';
			}
		},
		[movieId, refreshTracks],
	);

	return (
		<div class={styles.panel}>
			{/* Existing Tracks */}
			<button class={styles.sectionHeader} onClick={() => setTracksOpen(!tracksOpen)}>
				<span class={styles.sectionTitle}>
					Subtitles{tracks.length > 0 ? ` (${tracks.length})` : ''}
				</span>
				<span class={styles.arrow}>{tracksOpen ? '\u25B2' : '\u25BC'}</span>
			</button>

			{tracksOpen && (
				<div class={styles.trackList}>
					{tracks.length === 0 ? (
						<div class={styles.emptyText}>No subtitle tracks found</div>
					) : (
						tracks.map((t) => (
							<div
								key={t.index}
								class={styles.trackItem}
								onClick={() => onSelect?.(t)}
								role={onSelect ? 'button' : undefined}
							>
								<span class={styles.trackLang}>
									{(t.language || 'und').toUpperCase()}
								</span>
								<span class={styles.trackLabel}>{t.label}</span>
								{t.external && <span class={styles.badge}>External</span>}
								{t.forced && <span class={styles.badge}>Forced</span>}
								{t.codec && (
									<span class={styles.badgeMuted}>{t.codec.toUpperCase()}</span>
								)}
							</div>
						))
					)}
				</div>
			)}

			{/* Search */}
			<div class={styles.searchSection}>
				<button class={styles.actionBtn} onClick={handleSearch} disabled={isSearching}>
					{isSearching ? (
						<>
							<span class={styles.spinner} />
							Searching...
						</>
					) : (
						<>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<circle cx="11" cy="11" r="8" />
								<line x1="21" y1="21" x2="16.65" y2="16.65" />
							</svg>
							Search Online
						</>
					)}
				</button>

				{searchDone && searchResults.length === 0 && !isSearching && (
					<div class={styles.emptyText}>No subtitles found online</div>
				)}

				{searchResults.length > 0 && (
					<div class={styles.resultsList}>
						{searchResults.map((r) => (
							<div key={r.fileId} class={styles.resultItem}>
								<div class={styles.resultInfo}>
									<div class={styles.resultTopRow}>
										<span class={styles.resultLang}>
											{r.language.toUpperCase()}
										</span>
										{r.hashMatch && (
											<span class={styles.badgeAccent}>Hash Match</span>
										)}
										{r.hearingImpaired && (
											<span class={styles.badgeMuted}>HI</span>
										)}
										{r.format && (
											<span class={styles.badgeMuted}>
												{r.format.toUpperCase()}
											</span>
										)}
										{r.downloads != null && (
											<span class={styles.resultDownloads}>
												{r.downloads.toLocaleString()} DL
											</span>
										)}
									</div>
									{r.releaseName && (
										<span class={styles.resultRelease}>{r.releaseName}</span>
									)}
								</div>
								<button
									class={styles.downloadBtn}
									onClick={() => handleDownload(r)}
									disabled={downloadingId === r.fileId}
									title="Download subtitle"
								>
									{downloadingId === r.fileId ? (
										<span class={styles.spinner} />
									) : (
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
											<polyline points="7 10 12 15 17 10" />
											<line x1="12" y1="15" x2="12" y2="3" />
										</svg>
									)}
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Upload */}
			<div class={styles.uploadSection}>
				<button
					class={styles.actionBtn}
					onClick={() => fileInputRef.current?.click()}
					disabled={isUploading}
				>
					{isUploading ? (
						<>
							<span class={styles.spinner} />
							Uploading...
						</>
					) : (
						<>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<polyline points="17 8 12 3 7 8" />
								<line x1="12" y1="3" x2="12" y2="15" />
							</svg>
							Upload Subtitle File
						</>
					)}
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".srt,.vtt,.ass,.ssa,.sub"
					class={styles.hiddenInput}
					onChange={handleUpload}
				/>
			</div>

			{error && <div class={styles.error}>{error}</div>}
		</div>
	);
}

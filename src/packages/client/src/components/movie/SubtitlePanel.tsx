import type { MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import { useCallback, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Icon } from '@/components/common/Icon';
import { subtitlesService } from '@/services/subtitles.service';
import { globalMovie } from '@/state/globalPlayer.state';
import styles from './SubtitlePanel.module.scss';

interface SubtitlePanelProps {
	movieId: string;
	/** Pre-loaded subtitle tracks (from movie file info) */
	existingTracks?: MovieSubtitleInfo[];
	/** Called when a subtitle is selected for playback */
	onSelect?: (track: MovieSubtitleInfo) => void;
	/** Called when subtitles change (download/upload/delete) so parent can refresh */
	onSubtitlesChanged?: () => void;
	/** Called after a subtitle is downloaded/uploaded with the new track info */
	onTrackAdded?: (track: MovieSubtitleInfo) => void;
	/** Called after a subtitle is deleted with the deleted track info */
	onTrackDeleted?: (track: MovieSubtitleInfo) => void;
	/** Movie file name to display above search results for reference */
	fileName?: string;
}

export function SubtitlePanel({
	movieId,
	existingTracks,
	onSelect,
	onSubtitlesChanged,
	onTrackAdded,
	onTrackDeleted,
	fileName: fileNameProp,
}: SubtitlePanelProps) {
	// Resolve fileName: prop > globalMovie fileInfo > filePath extraction
	const fileName =
		fileNameProp ||
		globalMovie.value?.fileInfo?.fileName ||
		globalMovie.value?.fileInfo?.filePath?.split(/[/\\]/).pop();
	const [tracks, setTracks] = useState<MovieSubtitleInfo[]>(existingTracks ?? []);
	const [tracksOpen, setTracksOpen] = useState(true);
	const [searchResults, setSearchResults] = useState<SubtitleSearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchDone, setSearchDone] = useState(false);
	const [downloadingId, setDownloadingId] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmDeleteTrack, setConfirmDeleteTrack] = useState<MovieSubtitleInfo | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [filterQuery, setFilterQuery] = useState('');
	const [copied, setCopied] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const resultsRef = useRef<HTMLDivElement>(null);

	const refreshTracks = useCallback(async () => {
		try {
			const { subtitles } = await subtitlesService.list(movieId);
			setTracks(subtitles);
			onSubtitlesChanged?.();
		} catch {
			// Silently fail
		}
	}, [movieId, onSubtitlesChanged]);

	const handleDelete = useCallback(
		async (track: MovieSubtitleInfo) => {
			setIsDeleting(true);
			setError(null);
			try {
				await subtitlesService.remove(movieId, track.index);
				setConfirmDeleteTrack(null);
				onTrackDeleted?.(track);
				await refreshTracks();
			} catch (err: any) {
				setError(err.message || 'Delete failed');
			} finally {
				setIsDeleting(false);
			}
		},
		[movieId, refreshTracks, onTrackDeleted],
	);

	const handleSearchClick = useCallback(async () => {
		if (searchOpen && !searchDone) {
			// Toggle closed if no search has happened
			setSearchOpen(false);
			return;
		}
		if (searchOpen && searchDone && !filterQuery) {
			// Already open with results, empty filter — clear filter (no-op since already empty)
			// Just close the panel
			setSearchOpen(false);
			setSearchDone(false);
			setSearchResults([]);
			setFilterQuery('');
			return;
		}
		if (searchOpen && filterQuery) {
			// Clear the filter query
			setFilterQuery('');
			return;
		}
		// Perform search
		setSearchOpen(true);
		setIsSearching(true);
		setError(null);
		setSearchResults([]);
		setFilterQuery('');
		try {
			const { results } = await subtitlesService.search(movieId);
			setSearchResults(results);
			setSearchDone(true);
			if (results.length > 0) {
				setTimeout(
					() =>
						resultsRef.current?.scrollIntoView({
							behavior: 'smooth',
							block: 'nearest',
						}),
					50,
				);
			}
		} catch {
			setSearchDone(true);
			setSearchResults([]);
		} finally {
			setIsSearching(false);
		}
	}, [movieId, searchOpen, searchDone, filterQuery]);

	const handleDownload = useCallback(
		async (result: SubtitleSearchResult) => {
			setDownloadingId(result.fileId);
			setError(null);
			try {
				const { subtitle } = await subtitlesService.download(
					movieId,
					result.provider,
					result.fileId,
					result.language,
				);
				await refreshTracks();
				onTrackAdded?.(subtitle);
			} catch (err: any) {
				setError(err.message || 'Download failed');
			} finally {
				setDownloadingId(null);
			}
		},
		[movieId, refreshTracks, onTrackAdded],
	);

	const handleUpload = useCallback(
		async (e: Event) => {
			const input = e.target as HTMLInputElement;
			const file = input.files?.[0];
			if (!file) return;

			setIsUploading(true);
			setError(null);
			try {
				const { subtitle } = await subtitlesService.upload(movieId, file);
				await refreshTracks();
				onTrackAdded?.(subtitle);
			} catch (err: any) {
				setError(err.message || 'Upload failed');
			} finally {
				setIsUploading(false);
				input.value = '';
			}
		},
		[movieId, refreshTracks],
	);

	const handleCopyFileName = useCallback(() => {
		if (!fileName) return;
		navigator.clipboard.writeText(fileName).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, [fileName]);

	// Filter results by query
	const filteredResults = filterQuery
		? searchResults.filter((r) => {
				const q = filterQuery.toLowerCase();
				return (
					(r.releaseName || '').toLowerCase().includes(q) ||
					(r.language || '').toLowerCase().includes(q) ||
					(r.label || '').toLowerCase().includes(q) ||
					(r.format || '').toLowerCase().includes(q)
				);
			})
		: searchResults;

	return (
		<div class={styles.panel}>
			{/* Existing Tracks */}
			<button class={styles.sectionHeader} onClick={() => setTracksOpen(!tracksOpen)}>
				<span class={styles.sectionTitle}>
					Subtitles{tracks.length > 0 ? ` (${tracks.length})` : ''}
				</span>
				<span class={styles.arrow}><Icon name={tracksOpen ? 'chevron-up' : 'chevron-down'} size={12} /></span>
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
								<button
									class={styles.deleteTrackBtn}
									onClick={(e) => {
										e.stopPropagation();
										setConfirmDeleteTrack(t);
									}}
									title="Delete subtitle"
								>
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polyline points="3 6 5 6 21 6" />
										<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
										<path d="M10 11v6" />
										<path d="M14 11v6" />
									</svg>
								</button>
							</div>
						))
					)}
				</div>
			)}

			{/* Search Online */}
			<div class={styles.searchSection}>
				<button
					class={styles.sectionHeader}
					onClick={handleSearchClick}
					disabled={isSearching}
				>
					<span class={styles.sectionTitle}>
						{isSearching ? (
							<>
								<span class={styles.spinner} /> Searching...
							</>
						) : (
							'Search Online'
						)}
					</span>
					<span class={styles.searchHeaderRight}>
						{searchOpen && fileName && (
							<span class={styles.fileNameInline} title={fileName}>
								{fileName}
							</span>
						)}
						{searchOpen && fileName && (
							<button
								class={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
								onClick={(e) => {
									e.stopPropagation();
									handleCopyFileName();
								}}
								title="Copy file name"
							>
								{copied ? (
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="#4ade80"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polyline points="20 6 9 17 4 12" />
									</svg>
								) : (
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
										<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
									</svg>
								)}
							</button>
						)}
						<span class={styles.arrow}><Icon name={searchOpen ? 'chevron-up' : 'chevron-down'} size={12} /></span>
					</span>
				</button>

				{searchOpen && (
					<>
						{/* Filter input */}
						<div class={styles.filterWrap}>
							<input
								type="text"
								class={styles.filterInput}
								placeholder="Filter results..."
								value={filterQuery}
								onInput={(e) =>
									setFilterQuery((e.target as HTMLInputElement).value)
								}
							/>
							{filterQuery && (
								<button
									class={styles.filterClear}
									onClick={() => setFilterQuery('')}
									title="Clear filter"
								>
									<Icon name="x" size={12} />
								</button>
							)}
						</div>

						{searchDone && filteredResults.length === 0 && !isSearching && (
							<div class={styles.emptyText}>
								{searchResults.length === 0
									? 'No subtitles found online'
									: 'No results match filter'}
							</div>
						)}

						{filteredResults.length > 0 && (
							<div class={styles.resultsList} ref={resultsRef}>
								{filteredResults.map((r) => (
									<div key={r.fileId} class={styles.resultItem}>
										<div class={styles.resultInfo}>
											<div class={styles.resultTopRow}>
												<span class={styles.resultLang}>
													{r.language.toUpperCase()}
												</span>
												{r.hashMatch && (
													<span class={styles.badgeAccent}>
														Hash Match
													</span>
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
												<span class={styles.resultRelease}>
													{r.releaseName}
												</span>
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
					</>
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

			<ConfirmDialog
				isOpen={confirmDeleteTrack !== null}
				onClose={() => setConfirmDeleteTrack(null)}
				onConfirm={() => confirmDeleteTrack && handleDelete(confirmDeleteTrack)}
				title="Delete Subtitle?"
				message={
					confirmDeleteTrack && (
						<>
							<p class={styles.confirmDetail}>
								{confirmDeleteTrack.label}
								{confirmDeleteTrack.language &&
								confirmDeleteTrack.language !== 'und'
									? ` (${confirmDeleteTrack.language.toUpperCase()})`
									: ''}
								{confirmDeleteTrack.external ? ' — External' : ' — Embedded'}
								{confirmDeleteTrack.codec
									? ` — ${confirmDeleteTrack.codec.toUpperCase()}`
									: ''}
							</p>
							<p class={styles.confirmWarning}>
								{confirmDeleteTrack.external
									? 'This will delete the subtitle file from disk.'
									: 'This will remove the embedded track from the cache.'}
							</p>
						</>
					)
				}
				confirmLabel="Delete"
				variant="danger"
				loading={isDeleting}
			/>
		</div>
	);
}

import type { MovieSubtitleInfo, SubtitleSearchResult } from '@mu/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Icon } from '@/components/common/Icon';
import { subtitlesService } from '@/services/subtitles.service';
import { globalMovie } from '@/state/globalPlayer.state';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './SubtitlePanel.module.scss';

/**
 * Client mirror of the server's `SubtitleIngestionService.slugTag` — turns a
 * release name into the dot-free token embedded in a downloaded sidecar's
 * filename. Lets us detect which online results are already on disk.
 */
function slugTag(raw: string | undefined | null): string {
	if (!raw) return '';
	return raw
		.normalize('NFKD')
		.replace(/\.(srt|vtt|ass|ssa|sub)$/i, '')
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.toLowerCase();
}

/**
 * Pull the `<tag>` segment out of a sidecar filename shaped
 * `<base>.<lang>[.<tag>].<ext>` — i.e. the second-to-last dot segment, which is
 * where `writeSidecar` puts the slugified release name. Returns '' when the
 * file carries no tag (`<base>.<lang>.<ext>`), since the base is the movie
 * title and matching on it would flag unrelated results.
 */
function sidecarTag(fileName: string): string {
	const parts = fileName.toLowerCase().split('.');
	// Need at least base + lang + tag + ext to have a tag at all.
	if (parts.length < 4) return '';
	return parts[parts.length - 2] ?? '';
}

/**
 * Drop a redundant leading "<LANG> · " (or "<LANG> (Forced) · ") from a track
 * label — the row already shows the language in its own chip, so repeating it
 * before the release name is just noise.
 */
function stripLangPrefix(label: string | undefined, language: string | undefined): string {
	const text = label ?? '';
	const dot = text.indexOf('·');
	if (dot === -1) return text;
	const head = text
		.slice(0, dot)
		.replace(/\(forced\)/i, '')
		.trim()
		.toUpperCase();
	const rest = text.slice(dot + 1).trim();
	return head === (language ?? '').toUpperCase() && rest ? rest : text;
}

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
	/** Label + language of the subtitle currently enabled in the player, so the
	 * matching track in this list can be highlighted like the main subtitle menu. */
	activeLabel?: string | null;
	activeLanguage?: string | null;
}

export function SubtitlePanel({
	movieId,
	existingTracks,
	onSelect,
	onSubtitlesChanged,
	onTrackAdded,
	onTrackDeleted,
	fileName: fileNameProp,
	activeLabel,
	activeLanguage,
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

	// Load the authoritative track list (real DB indices, fileName, default flag)
	// on mount — the `existingTracks` prop is session-derived and uses array
	// positions, which don't line up with the indices the server expects.
	useEffect(() => {
		refreshTracks();
	}, [movieId]);

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

	const handleSetDefault = useCallback(
		async (track: MovieSubtitleInfo) => {
			setError(null);
			try {
				await subtitlesService.setDefault(movieId, track.index);
				await refreshTracks();
			} catch (err: any) {
				setError(err.message || 'Failed to set default subtitle');
			}
		},
		[movieId, refreshTracks],
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
					result.releaseName || result.label,
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
		void copyToClipboard(fileName).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, [fileName]);

	// Which online results we already have on disk.
	//
	// Primary key is `sourceId` (`<provider>:<fileId>`), stamped at download
	// time — unique per result, so exactly one row lights up. The old approach
	// matched a slugified release name as a *substring* of the sidecar
	// filename, which flagged every result once one was downloaded: providers
	// hand back many results sharing a release name (or none at all, in which
	// case the label falls back to "<Title> (Year)" — a substring of every
	// sidecar, since the sidecar is named after the movie file).
	//
	// Legacy rows (downloaded before sourceId existed) fall back to a filename
	// match, but now against the exact `<tag>` *segment* rather than any
	// substring, and only when the tag is discriminating.
	const downloadedResultIds = useMemo(() => {
		const ids = new Set<string>();
		const external = tracks.filter((t) => t.external);
		if (external.length === 0) return ids;

		const sourceIds = new Set(external.map((t) => t.sourceId).filter((v): v is string => !!v));
		// Only legacy rows need the filename heuristic.
		const legacy = external
			.filter((t) => !t.sourceId && t.fileName)
			.map((t) => ({
				lang: (t.language ?? '').slice(0, 2).toLowerCase(),
				tag: sidecarTag(t.fileName as string),
			}))
			.filter((t) => t.tag.length > 0);

		for (const r of searchResults) {
			if (sourceIds.has(`${r.provider}:${r.fileId}`)) {
				ids.add(r.fileId);
				continue;
			}
			// A result with no release name yields a tag equal to the movie
			// title, which can't distinguish it from its siblings — skip it
			// rather than flag them all.
			if (!r.releaseName) continue;
			const slug = slugTag(r.releaseName);
			if (!slug) continue;
			const rlang = (r.language ?? '').slice(0, 2).toLowerCase();
			if (legacy.some((d) => d.lang === rlang && d.tag === slug)) ids.add(r.fileId);
		}
		return ids;
	}, [searchResults, tracks]);

	// Filter: split on commas into AND terms — a result must include EVERY term
	// (matched across release name / language / label / format) to be shown.
	const filterTerms = filterQuery
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const filteredResults =
		filterTerms.length === 0
			? searchResults
			: searchResults.filter((r) => {
					const hay =
						`${r.releaseName ?? ''} ${r.language ?? ''} ${r.label ?? ''} ${r.format ?? ''}`.toLowerCase();
					return filterTerms.every((term) => hay.includes(term));
				});

	// Already-downloaded results float to the top (stable ordering otherwise).
	const orderedResults = [...filteredResults].sort(
		(a, b) =>
			Number(downloadedResultIds.has(b.fileId)) - Number(downloadedResultIds.has(a.fileId)),
	);

	return (
		<div class={styles.panel}>
			{/* Existing Tracks */}
			<button class={styles.sectionHeader} onClick={() => setTracksOpen(!tracksOpen)}>
				<span class={styles.sectionTitle}>
					Subtitles{tracks.length > 0 ? ` (${tracks.length})` : ''}
				</span>
				<span class={styles.arrow}>
					<Icon name={tracksOpen ? 'chevron-up' : 'chevron-down'} size={12} />
				</span>
			</button>

			{tracksOpen && (
				<div class={styles.trackList}>
					{tracks.length === 0 ? (
						<div class={styles.emptyText}>No subtitle tracks found</div>
					) : (
						tracks.map((t) => {
							// Highlight the track currently enabled in the player. The
							// active subtitle is identified by label + language (both
							// derive from the same server-parsed title, so they match).
							const isActive =
								activeLabel != null &&
								t.label === activeLabel &&
								(t.language ?? '').toLowerCase() ===
									(activeLanguage ?? '').toLowerCase();
							return (
								<div
									key={t.index}
									class={`${styles.trackItem} ${isActive ? styles.trackActive : ''}`}
									onClick={() => onSelect?.(t)}
									role={onSelect ? 'button' : undefined}
									title={t.fileName || t.label}
								>
									<span class={styles.trackLang}>
										{(t.language || 'und').toUpperCase()}
									</span>
									<span class={styles.trackLabel} title={t.fileName || t.label}>
										{stripLangPrefix(t.label, t.language)}
									</span>
									{isActive && <span class={styles.badgePlaying}>Playing</span>}
									{t.default && <span class={styles.badgeDefault}>Default</span>}
									{t.forced && <span class={styles.badge}>Forced</span>}
									{t.codec && (
										<span class={styles.badgeMuted}>
											{t.codec.toUpperCase()}
										</span>
									)}
									{!t.default && (
										<button
											class={styles.setDefaultBtn}
											onClick={(e) => {
												e.stopPropagation();
												handleSetDefault(t);
											}}
											title="Set as default subtitle"
										>
											Set default
										</button>
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
							);
						})
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
						<span class={styles.arrow}>
							<Icon name={searchOpen ? 'chevron-up' : 'chevron-down'} size={12} />
						</span>
					</span>
				</button>

				{searchOpen && (
					<>
						{/* Filter input */}
						<div class={styles.filterWrap}>
							<input
								type="text"
								class={styles.filterInput}
								placeholder="Filter results (comma = all terms)..."
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

						{searchDone && orderedResults.length === 0 && !isSearching && (
							<div class={styles.emptyText}>
								{searchResults.length === 0
									? 'No subtitles found online'
									: 'No results match filter'}
							</div>
						)}

						{orderedResults.length > 0 && (
							<div class={styles.resultsList} ref={resultsRef}>
								{orderedResults.map((r) => {
									const isDownloaded = downloadedResultIds.has(r.fileId);
									return (
										<div
											key={r.fileId}
											class={`${styles.resultItem} ${isDownloaded ? styles.resultDownloaded : ''}`}
											title={r.releaseName || r.label}
										>
											<div class={styles.resultInfo}>
												<div class={styles.resultTopRow}>
													<span class={styles.resultLang}>
														{r.language.toUpperCase()}
													</span>
													{isDownloaded && (
														<span class={styles.badgeDownloaded}>
															Downloaded
														</span>
													)}
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
												title={
													isDownloaded
														? 'Already downloaded — download again'
														: 'Download subtitle'
												}
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
									);
								})}
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

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { CommentsPanel } from '@/components/comments/CommentsPanel';
import { Button } from '@/components/common/Button';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import { SmartImage } from '@/components/common/SmartImage';
import { Spinner } from '@/components/common/Spinner';
import { CastPhoto } from '@/components/movie/CastPhoto';
import { ExternalRatings } from '@/components/movie/ExternalRatings';
import { FileInfoGrid } from '@/components/movie/FileInfoGrid';
import { MatchCandidatesPanel } from '@/components/movie/MatchCandidatesPanel';
import { MovieBreadcrumbs } from '@/components/movie/MovieBreadcrumbs';
import { MovieOptionsMenu } from '@/components/movie/MovieOptionsMenu';
import { MoviePlaylists } from '@/components/movie/MoviePlaylists';
import { PlaybackBadge } from '@/components/movie/PlaybackBadge';
import { RatingWidget } from '@/components/movie/RatingWidget';
import { ShareMovieModal } from '@/components/movie/ShareMovieModal';
import { SubtitlePanel } from '@/components/movie/SubtitlePanel';
import { TrailerSection } from '@/components/movie/TrailerSection';
import { useSeo } from '@/hooks/useSeo';
import { useWatchPosition } from '@/hooks/useWatchPosition';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { type AudioProfile, audioProfilesService } from '@/services/audio-profiles.service';
import { bookmarksService } from '@/services/discover.service';
import { jobsService } from '@/services/jobs.service';
import { type MatchCandidate, moviesService } from '@/services/movies.service';
import { wsService } from '@/services/websocket.service';
import { currentUser } from '@/state/auth.state';
import { countComments, loadComments } from '@/state/comments.state';
import { personKeyFor } from '@/state/favorites.state';
import { forceStartPosition, playMovie } from '@/state/globalPlayer.state';
import { updateMovieInHistory } from '@/state/history.state';
import { type Movie, updateMovieInList } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { fetchProcessingMovies, processingMovieIds } from '@/state/processing.state';
import { relativeTime } from '@/utils/time-format';
import { getWatchPercent, hasWatchProgress } from '@/utils/watch-progress';
import styles from './MovieDetail.module.scss';

interface MovieDetailProps {
	path?: string;
	id?: string;
}

export function MovieDetail({ id }: MovieDetailProps) {
	const [movie, setMovie] = useState<Movie | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [inWatchlist, setInWatchlist] = useState(false);
	const [showShareModal, setShowShareModal] = useState(false);

	useSeo(
		movie
			? {
					title: movie.year ? `${movie.title} (${movie.year})` : movie.title,
					description: movie.overview ?? undefined,
					image: movie.posterUrl || movie.backdropUrl || undefined,
					type: 'video.movie',
				}
			: null,
	);

	// Subscribe to the live watch-position signal so the Resume
	// button + progress bar update in real time as playback advances
	// in the global player (and across tabs / devices).
	const watch = useWatchPosition(movie?.id ?? null, {
		watchPosition: movie?.watchPosition,
		durationSeconds: movie?.durationSeconds,
	});
	const showResume = !!watch?.hasProgress;
	const resumePercent = watch?.percent ?? (movie ? getWatchPercent(movie) : 0);

	// Transcode progress tracking
	const [transcodeProgress, setTranscodeProgress] = useState<number | null>(null);
	const [processingJobId, setProcessingJobId] = useState<string | null>(null);

	// Inline title editing
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState('');
	const [isSavingTitle, setIsSavingTitle] = useState(false);
	const titleInputRef = useRef<HTMLInputElement>(null);

	// Ambiguous-match candidates persisted by the matcher
	const [candidates, setCandidates] = useState<MatchCandidate[]>([]);

	useEffect(() => {
		if (!id) return;

		async function load() {
			setIsLoading(true);
			try {
				const data = await moviesService.get(id!);
				setMovie(data);
				setInWatchlist(data.inWatchlist ?? false);
			} catch (error) {
				console.error('Failed to load movie:', error);
				notifyError('Failed to load movie details');
			} finally {
				setIsLoading(false);
			}
		}

		load();
		// Refresh processing state so stale "processing" indicators are cleared
		fetchProcessingMovies();
	}, [id]);

	// Load any persisted match candidates for this movie.
	useEffect(() => {
		if (!id) return;
		let cancelled = false;
		moviesService
			.listMatchCandidates(id)
			.then((res) => {
				if (!cancelled) setCandidates(res.candidates ?? []);
			})
			.catch(() => {
				// Non-fatal — candidates table may not exist on older deploys.
			});
		return () => {
			cancelled = true;
		};
	}, [id]);

	const handleApplyCandidate = useCallback(
		async (c: MatchCandidate) => {
			if (!id) return;
			try {
				await moviesService.applyMatchCandidate(id, c.provider, c.externalId);
				setCandidates([]);
				// Re-fetch the movie so the new metadata shows up.
				const updated = await moviesService.get(id);
				setMovie(updated);
				notifySuccess(`Applied "${c.title}" as the match.`);
			} catch (err: any) {
				notifyError(`Could not apply candidate: ${err?.message ?? 'unknown error'}`);
			}
		},
		[id],
	);

	const handleDismissCandidates = useCallback(async () => {
		if (!id) return;
		try {
			await moviesService.clearMatchCandidates(id);
			setCandidates([]);
		} catch (err: any) {
			notifyError(`Could not clear candidates: ${err?.message ?? 'unknown error'}`);
		}
	}, [id]);

	// Re-fetch movie when the server notifies us of an update
	// (e.g. after re-scan, pre-transcode completion, metadata refresh)
	useEffect(() => {
		if (!id) return;

		const handler = (data: unknown) => {
			const event = data as { movieId?: string; source?: string };
			if (event.movieId === id) {
				// Server emits this whenever metadata moves — including the
				// 'metadata-candidates' case where ambiguous candidates were
				// freshly persisted. Refresh both the movie and the candidate
				// list so the dropdown appears/clears live.
				moviesService
					.listMatchCandidates(id)
					.then((res) => setCandidates(res.candidates ?? []))
					.catch(() => {});
				moviesService
					.get(id)
					.then((updated) => {
						setMovie(updated);
						// Keep the library grid + history/recent views in sync too.
						updateMovieInList(updated);
						updateMovieInHistory(updated);
					})
					.catch(() => {});
			}
		};

		wsService.on('library:movie-updated', handler);
		return () => wsService.off('library:movie-updated', handler);
	}, [id]);

	// Subscribe to transcode progress events
	useEffect(() => {
		if (!id) return;

		const onProgress = (data: unknown) => {
			const ev = data as {
				id?: string;
				type?: string;
				progress?: number;
				payload?: { movieId?: string };
			};
			if (ev.type === 'pre-transcode' && ev.payload?.movieId === id) {
				setTranscodeProgress(ev.progress ?? null);
				if (ev.id) setProcessingJobId(ev.id);
			}
		};
		const onDone = (data: unknown) => {
			const ev = data as { type?: string; payload?: { movieId?: string } };
			if (ev.type === 'pre-transcode' && ev.payload?.movieId === id) {
				setTranscodeProgress(null);
				setProcessingJobId(null);
				// Re-fetch movie to update status
				moviesService
					.get(id)
					.then((updated) => setMovie(updated))
					.catch(() => {});
			}
		};

		wsService.on('job:progress', onProgress);
		wsService.on('job:completed', onDone);
		wsService.on('job:failed', onDone);
		return () => {
			wsService.off('job:progress', onProgress);
			wsService.off('job:completed', onDone);
			wsService.off('job:failed', onDone);
		};
	}, [id]);

	// Fetch the active job id for this movie so the "processing" indicator can
	// deep-link to its job-details page immediately (even for a queued job that
	// hasn't emitted a progress event yet). Admin-only feature, but the lookup
	// is cheap and gated on the movie actually processing.
	useEffect(() => {
		if (!id || !movie) return;
		const isProcessing =
			movie.status === 'processing' ||
			movie.status === 'processing_playable' ||
			processingMovieIds.value.has(id);
		if (!isProcessing) {
			setProcessingJobId(null);
			return;
		}
		let cancelled = false;
		jobsService
			.movieStatus(id)
			.then((s) => {
				if (!cancelled && s.jobId) setProcessingJobId(s.jobId);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [id, movie?.status]);

	// Deep-link: /movie/:id?t=<seconds> (a "private" share link) — auto-play at
	// that time once the movie has loaded, then strip ?t so a refresh / back-nav
	// doesn't re-seek.
	const sharedSeekDone = useRef(false);
	useEffect(() => {
		if (!movie || sharedSeekDone.current) return;
		const t = new URLSearchParams(window.location.search).get('t');
		if (t == null) return;
		sharedSeekDone.current = true;
		const seconds = Math.max(0, Number.parseFloat(t) || 0);
		if (seconds > 0) forceStartPosition.value = seconds;
		void playMovie(movie.id);
		route(`/movie/${movie.id}`, true);
	}, [movie?.id]);

	const handlePlay = useCallback(() => {
		if (movie) {
			playMovie(movie.id, { fromBeginning: true });
		}
	}, [movie]);

	const handleResume = useCallback(() => {
		if (movie) {
			playMovie(movie.id);
		}
	}, [movie]);

	const handleRate = useCallback(
		async (rating: number) => {
			if (!movie) return;
			try {
				await moviesService.rate(movie.id, rating);
				setMovie({ ...movie, rating });
				notifySuccess('Rating saved');
			} catch {
				notifyError('Failed to save rating');
			}
		},
		[movie],
	);

	const handleWatchlistToggle = useCallback(async () => {
		if (!movie) return;
		try {
			const result = await moviesService.toggleWatchlist(movie.id);
			setInWatchlist(result.inWatchlist);
			notifySuccess(result.inWatchlist ? 'Added to watchlist' : 'Removed from watchlist');
		} catch {
			notifyError('Failed to update watchlist');
		}
	}, [movie]);

	const handleCancelProcessing = useCallback(async () => {
		if (!movie) return;
		try {
			await moviesService.cancelProcessing(movie.id);
			const updated = await moviesService.get(movie.id);
			setMovie(updated);
			notifySuccess('Processing cancelled');
		} catch {
			notifyError('Failed to cancel processing');
		}
	}, [movie]);

	const [showFileInfo, setShowFileInfo] = useState(false);
	const [showPlaySettings, setShowPlaySettings] = useState(false);
	const [showSubtitles, setShowSubtitles] = useState(false);
	const [showPlaylists, setShowPlaylists] = useState(false);
	const [showComments, setShowComments] = useState(false);
	// Comment count for the section header (panel itself loads on expand too).
	useEffect(() => {
		if (id) loadComments(id).catch(() => {});
	}, [id]);
	// Cast is expanded on desktop, collapsed on mobile. Track explicit
	// state so the user toggle works on both; the initial value flips
	// based on viewport width at mount.
	const [showCast, setShowCast] = useState(() => {
		if (typeof window === 'undefined') return true;
		return window.matchMedia('(min-width: 768px)').matches;
	});
	const [playlistCount, setPlaylistCount] = useState(0);
	const [audioProfiles, setAudioProfiles] = useState<AudioProfile[]>([]);
	const [selectedEqProfile, setSelectedEqProfile] = useState<string>('');
	const [selectedCompProfile, setSelectedCompProfile] = useState<string>('');
	const [selectedVideoProfile, setSelectedVideoProfile] = useState<string>('');
	// Load audio profiles when play settings section is opened
	useEffect(() => {
		if (!showPlaySettings) return;
		audioProfilesService
			.getAll()
			.then(setAudioProfiles)
			.catch(() => {});
	}, [showPlaySettings]);

	// Sync play settings state from movie data
	useEffect(() => {
		if (!movie) return;
		const ps = movie.playSettings;
		setSelectedEqProfile(ps?.eqProfileId ?? '');
		setSelectedCompProfile(ps?.compressorProfileId ?? '');
		setSelectedVideoProfile((ps as any)?.videoProfileId ?? '');
		if (ps && Object.keys(ps).length > 0) {
			setShowPlaySettings(true);
		}
	}, [movie?.id, movie?.playSettings]);

	const updatePlaySetting = useCallback(
		async (key: string, value: string | null) => {
			if (!movie) return;
			const parsed = value || null;
			const patch = { [key]: parsed };
			try {
				await moviesService.update(movie.id, {
					playSettings: JSON.stringify(patch),
				});
				setMovie((prev) => {
					if (!prev) return prev;
					const merged = { ...prev.playSettings, ...patch };
					// Remove null keys
					for (const k of Object.keys(merged)) {
						if ((merged as any)[k] === null) delete (merged as any)[k];
					}
					const hasSettings = Object.keys(merged).length > 0;
					return {
						...prev,
						playSettings: hasSettings ? (merged as Movie['playSettings']) : null,
					};
				});
			} catch {
				notifyError('Failed to save play setting');
			}
		},
		[movie],
	);

	const handleMovieUpdate = useCallback((updated: Movie) => {
		setMovie(updated);
		// Propagate to the global caches so the library grid and the recent /
		// history views show the refreshed poster/title without a manual reload.
		updateMovieInList(updated);
		updateMovieInHistory(updated);
	}, []);

	// -- Title editing --

	const startEditingTitle = useCallback(() => {
		if (!movie) return;
		setTitleDraft(movie.title);
		setEditingTitle(true);
		// Focus the input after render
		requestAnimationFrame(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		});
	}, [movie]);

	const cancelEditingTitle = useCallback(() => {
		setEditingTitle(false);
	}, []);

	const saveTitle = useCallback(async () => {
		if (!movie) return;
		const trimmed = titleDraft.trim();
		if (!trimmed || trimmed === movie.title) {
			setEditingTitle(false);
			return;
		}

		setIsSavingTitle(true);
		try {
			await moviesService.update(movie.id, { title: trimmed });
			setMovie({ ...movie, title: trimmed });
			setEditingTitle(false);
			notifySuccess('Title updated');
		} catch {
			notifyError('Failed to update title');
		} finally {
			setIsSavingTitle(false);
		}
	}, [movie, titleDraft]);

	const handleTitleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveTitle();
			} else if (e.key === 'Escape') {
				cancelEditingTitle();
			}
		},
		[saveTitle, cancelEditingTitle],
	);

	if (isLoading) {
		return (
			<div class={styles.loading}>
				<Spinner size="lg" />
			</div>
		);
	}

	if (!movie) {
		return (
			<div class={styles.notFound}>
				<h2>Movie not found</h2>
				<Button variant="secondary" onClick={() => route('/library')}>
					Back to Library
				</Button>
			</div>
		);
	}

	const isRemote = !!movie.remoteOrigin;
	// Preview mode: movies that aren't playable from this server (a
	// Discover-page "Not in library" external candidate, or a user's
	// saved bookmark). Detail page becomes read-only — cast, plot,
	// ratings, trailer, See Similar — with Bookmark replacing Play /
	// Watchlist / Share. Falls through to normal behaviour for
	// undefined source (legacy rows, treat as library).
	const isPreview = movie.source != null && movie.source !== 'library';

	const hours = Math.floor(movie.runtime / 60);
	const mins = movie.runtime % 60;
	const runtimeText = movie.runtime
		? hours > 0
			? mins > 0
				? `${hours} hour${hours !== 1 ? 's' : ''}, ${mins} minute${mins !== 1 ? 's' : ''}`
				: `${hours} hour${hours !== 1 ? 's' : ''}`
			: `${mins} minute${mins !== 1 ? 's' : ''}`
		: '';

	return (
		<div class={styles.detail}>
			{/* Backdrop */}
			{movie.backdropUrl && (
				<div class={styles.backdrop}>
					<img src={movie.backdropUrl} alt="" class={styles.backdropImage} />
					<div class={styles.backdropGradient} />
				</div>
			)}

			{/* Inner content — max-width constrained */}
			<div class={styles.innerWrap}>
				{/* Back button */}
				<button
					class={styles.backButton}
					onClick={() => route('/library')}
					aria-label="Back to Library"
				>
					<Icon name="arrow-left" size={14} /> Library
				</button>

				{/* Content */}
				<div class={styles.content}>
					{/* Poster */}
					<div class={styles.posterColumn}>
						<div class={styles.poster}>
							<SmartImage
								src={movie.posterUrl}
								alt={`${movie.title} poster`}
								imgClass={styles.posterImg}
								fallbackLabel={movie.title}
							/>
						</div>
					</div>

					{/* Info */}
					<div class={styles.infoColumn}>
						{/* Title */}
						{!isRemote && editingTitle ? (
							<div class={styles.titleEditRow}>
								<input
									ref={titleInputRef}
									type="text"
									class={styles.titleInput}
									value={titleDraft}
									onInput={(e) =>
										setTitleDraft((e.target as HTMLInputElement).value)
									}
									onKeyDown={handleTitleKeyDown}
									disabled={isSavingTitle}
								/>
								<button
									class={styles.titleSaveBtn}
									onClick={saveTitle}
									disabled={isSavingTitle}
									aria-label="Save title"
								>
									{isSavingTitle ? '…' : <Icon name="check" size={14} />}
								</button>
								<button
									class={styles.titleCancelBtn}
									onClick={cancelEditingTitle}
									disabled={isSavingTitle}
									aria-label="Cancel editing"
								>
									<Icon name="x" size={14} />
								</button>
							</div>
						) : isRemote ? (
							<div class={styles.titleRow}>
								<h1 class={styles.title}>{movie.title}</h1>
								<FavoriteButton
									entityType="movie"
									movieId={movie.id}
									size="large"
									stopPropagation
								/>
							</div>
						) : (
							<div class={styles.titleRow}>
								<h1 class={styles.title} onClick={startEditingTitle}>
									{movie.title}
								</h1>
								<span class={styles.titleEditIcon} onClick={startEditingTitle}>
									<Icon name="edit" size={12} />
								</span>
								<FavoriteButton
									entityType="movie"
									movieId={movie.id}
									size="large"
									stopPropagation
								/>
								{!isPreview && (
									<button
										type="button"
										class={styles.shareIconBtn}
										onClick={() => setShowShareModal(true)}
										title="Share this movie"
										aria-label="Share this movie"
									>
										<Icon name="share" size={20} />
									</button>
								)}
							</div>
						)}

						{movie.tagline && <p class={styles.tagline}>{movie.tagline}</p>}

						<MatchCandidatesPanel
							candidates={candidates}
							onApply={handleApplyCandidate}
							onDismiss={handleDismissCandidates}
						/>

						<div class={styles.meta}>
							{movie.contentRating && (
								<span class={styles.contentRatingBadge}>{movie.contentRating}</span>
							)}
							{movie.year > 0 && <span>{movie.year}</span>}
							{movie.hidden && <span class={styles.hiddenBadge}>Hidden</span>}
							{isRemote && movie.remoteOrigin && (
								<span class={styles.remoteBadge}>
									{movie.remoteOrigin.serverName}
								</span>
							)}
							{runtimeText && <span>{runtimeText}</span>}
							{movie.director && (
								<span class={styles.directorRow} data-reveal-host>
									<a
										class={styles.directorLink}
										href={`/person/${personKeyFor({ name: movie.director })}`}
										onClick={(e) => {
											e.preventDefault();
											route(
												`/person/${personKeyFor({ name: movie.director! })}`,
											);
										}}
									>
										Dir. {movie.director}
									</a>
									<FavoriteButton
										entityType="person"
										name={movie.director}
										personRole="director"
										size="mini"
										stopPropagation
										revealOnHover
									/>
								</span>
							)}
							{movie.addedAt && (
								<span
									class={styles.addedAt}
									title={new Date(movie.addedAt).toLocaleString()}
								>
									Added {relativeTime(movie.addedAt)}
								</span>
							)}
							{movie.groupId && <MovieBreadcrumbs movie={movie} />}
						</div>

						{/* Genres */}
						{movie.genres && movie.genres.length > 0 && (
							<div class={styles.genres}>
								{movie.genres.map((genre) => (
									<span key={genre} class={styles.genreTag}>
										{genre}
									</span>
								))}
							</div>
						)}

						{/* Ratings */}
						<div class={styles.ratings}>
							{!isRemote && (
								<div class={styles.userRating}>
									<span class={styles.ratingLabel}>Your Rating</span>
									<RatingWidget
										value={movie.rating}
										editable
										onChange={handleRate}
										size="lg"
									/>
								</div>
							)}
							<ExternalRatings
								imdbRating={movie.imdbRating}
								rtRating={movie.rtRating}
								metacriticRating={movie.metacriticRating}
								imdbId={movie.imdbId}
								imdbVotes={movie.imdbVotes}
							/>
							<PluginSlot name={UI.MOVIE_PAGE_RATING} context={{ movie }} />
						</div>

						{/* Actions */}
						<div class={styles.actions}>
							{isPreview ? (
								<PreviewActions movie={movie} />
							) : (movie.status === 'processing' ||
									movie.status === 'processing_playable' ||
									processingMovieIds.value.has(movie.id)) &&
								!isRemote ? (
								<div class={styles.processingStatus}>
									{movie.status === 'processing_playable' && (
										<Button
											variant="primary"
											size="lg"
											onClick={handlePlay}
											class={styles.playProcessing}
											title={
												transcodeProgress != null
													? `Still transcoding — ${Math.round(transcodeProgress)}% done. You can watch the live stream now, but waiting for the cache to finish gives the smoothest playback.`
													: 'Still transcoding. You can watch the live stream now, but waiting gives the smoothest playback.'
											}
										>
											<Icon name="play" size={14} /> Play (live)
										</Button>
									)}
									<div
										class={`${styles.transcodeInfo}${
											currentUser.value?.role === 'admin' && processingJobId
												? ` ${styles.transcodeInfoLink}`
												: ''
										}`}
										role={
											currentUser.value?.role === 'admin' && processingJobId
												? 'button'
												: undefined
										}
										tabIndex={
											currentUser.value?.role === 'admin' && processingJobId
												? 0
												: undefined
										}
										title={
											currentUser.value?.role === 'admin' && processingJobId
												? 'Manage this job — prioritize, pause, or cancel'
												: undefined
										}
										onClick={
											currentUser.value?.role === 'admin' && processingJobId
												? () => route(`/admin/jobs/${processingJobId}`)
												: undefined
										}
									>
										{transcodeProgress != null ? (
											<>
												<div class={styles.transcodeProgressBar}>
													<div
														class={styles.transcodeProgressFill}
														style={{
															width: `${transcodeProgress.toFixed(0)}%`,
														}}
													/>
												</div>
												<span class={styles.transcodeProgressText}>
													Transcoding: {transcodeProgress.toFixed(0)}%
												</span>
											</>
										) : (
											<>
												<Spinner size="sm" />
												<span>Processing...</span>
											</>
										)}
										{currentUser.value?.role === 'admin' && processingJobId && (
											<Icon name="chevron-right" size={14} />
										)}
									</div>
									<Button
										variant="ghost"
										size="lg"
										onClick={handleCancelProcessing}
									>
										<Icon name="x" size={14} /> Cancel
									</Button>
								</div>
							) : showResume ? (
								<div class={styles.playGroup}>
									<div class={styles.hybridBtn}>
										<button
											class={styles.hybridPlay}
											onClick={handlePlay}
											aria-label="Play from beginning"
										>
											<Icon name="play" size={14} />
										</button>
										<button class={styles.hybridResume} onClick={handleResume}>
											Resume
										</button>
									</div>
									<div class={styles.playProgressBar}>
										<div
											class={styles.playProgressFill}
											style={{ width: `${resumePercent}%` }}
										/>
									</div>
								</div>
							) : (
								<Button variant="primary" size="lg" onClick={handlePlay}>
									<Icon name="play" size={14} /> Play
								</Button>
							)}
							{!isRemote && !isPreview && (
								<Button
									variant={inWatchlist ? 'secondary' : 'ghost'}
									size="lg"
									onClick={handleWatchlistToggle}
								>
									{inWatchlist ? (
										<>
											<Icon name="check" size={14} /> In Watchlist
										</>
									) : (
										<>
											<Icon name="star" size={14} /> Watchlist
										</>
									)}
								</Button>
							)}
							<Button
								variant="ghost"
								size="lg"
								onClick={() => {
									const label = encodeURIComponent(movie.title);
									route(
										`/discover?seedMovieId=${encodeURIComponent(movie.id)}&seedLabel=${label}`,
									);
								}}
								title="Find similar movies"
							>
								<Icon name="search" size={14} /> See Similar
							</Button>
							{!isRemote && !isPreview && (
								<MovieOptionsMenu
									movie={movie}
									onMovieUpdate={handleMovieUpdate}
									onMovieRemoved={() => route('/library')}
								/>
							)}
						</div>

						{/* Overview */}
						{movie.overview && (
							<div class={styles.overviewSection}>
								<h2 class={styles.sectionTitle}>Overview</h2>
								<p class={styles.overview}>{movie.overview}</p>
							</div>
						)}

						{/* Trailer (collapsible, lazy-loaded iframe) */}
						<TrailerSection
							trailerUrl={movie.trailerUrl}
							posterUrl={movie.backdropUrl || movie.posterUrl}
						/>

						{/* Details */}
						{(movie.writers?.length ||
							movie.productionCompanies?.length ||
							movie.budget ||
							movie.revenue ||
							movie.language ||
							movie.releaseDate ||
							movie.trailerUrl) && (
							<div class={styles.detailsSection}>
								<h2 class={styles.sectionTitle}>Details</h2>
								<div class={styles.detailsGrid}>
									{movie.writers && movie.writers.length > 0 && (
										<>
											<span class={styles.detailLabel}>Writers</span>
											<span class={styles.detailValue}>
												{movie.writers.join(', ')}
											</span>
										</>
									)}
									{movie.releaseDate && (
										<>
											<span class={styles.detailLabel}>Release Date</span>
											<span class={styles.detailValue}>
												{new Date(movie.releaseDate).toLocaleDateString(
													undefined,
													{
														year: 'numeric',
														month: 'long',
														day: 'numeric',
													},
												)}
											</span>
										</>
									)}
									{movie.language && (
										<>
											<span class={styles.detailLabel}>Language</span>
											<span class={styles.detailValue}>
												{movie.language.toUpperCase()}
											</span>
										</>
									)}
									{movie.country && (
										<>
											<span class={styles.detailLabel}>Country</span>
											<span class={styles.detailValue}>{movie.country}</span>
										</>
									)}
									{movie.productionCompanies &&
										movie.productionCompanies.length > 0 && (
											<>
												<span class={styles.detailLabel}>Production</span>
												<span class={styles.detailValue}>
													{movie.productionCompanies.join(', ')}
												</span>
											</>
										)}
									{movie.budget != null && movie.budget > 0 && (
										<>
											<span class={styles.detailLabel}>Budget</span>
											<span class={styles.detailValue}>
												${(movie.budget / 1_000_000).toFixed(0)}M
											</span>
										</>
									)}
									{movie.revenue != null && movie.revenue > 0 && (
										<>
											<span class={styles.detailLabel}>Box Office</span>
											<span class={styles.detailValue}>
												${(movie.revenue / 1_000_000).toFixed(1)}M
											</span>
										</>
									)}
									{/* Trailer moved out to a dedicated collapsible
										section above. Detail grid keeps its other
										rows. */}
								</div>
							</div>
						)}

						{/* Keywords */}
						{movie.keywords && movie.keywords.length > 0 && (
							<div class={styles.keywordsSection}>
								<div class={styles.genres}>
									{movie.keywords.map((kw) => (
										<span key={kw} class={styles.keywordTag}>
											{kw}
										</span>
									))}
								</div>
							</div>
						)}

						{/* Cast — plain heading on desktop, mobile-only
						    collapsible. The toggle button + chevron are
						    hidden on desktop by CSS so the section reads as a
						    normal h2; on mobile they reveal the same layout
						    used by the other collapsibles (Playlists, etc). */}
						{movie.cast && movie.cast.length > 0 && (
							<div class={styles.castSection}>
								<button
									class={`${styles.fileInfoToggle} ${styles.castToggle}`}
									onClick={() => setShowCast(!showCast)}
									type="button"
									aria-expanded={showCast}
								>
									<h2 class={styles.sectionTitle}>Cast</h2>
									<span class={`${styles.fileInfoArrow} ${styles.castArrow}`}>
										<Icon
											name={showCast ? 'chevron-up' : 'chevron-down'}
											size={14}
										/>
									</span>
								</button>
								<div
									class={`${styles.castGrid} ${
										!showCast ? styles.castGridCollapsed : ''
									}`}
								>
									{movie.cast.slice(0, 12).map((member) => {
										const key = personKeyFor({
											tmdbId: member.tmdbId,
											name: member.name,
										});
										return (
											<a
												key={member.name}
												class={styles.castMember}
												href={`/person/${key}`}
												data-reveal-host
												onClick={(e) => {
													e.preventDefault();
													route(`/person/${key}`);
												}}
											>
												<CastPhoto
													name={member.name}
													profileUrl={member.profileUrl}
													character={member.character}
													size={52}
													expandedSize={220}
													thumbClass={styles.castAvatar}
												/>
												<div class={styles.castInfo}>
													<span class={styles.castName}>
														{member.name}
													</span>
													<span class={styles.castCharacter}>
														{member.character}
													</span>
												</div>
												<div class={styles.castActions}>
													<span class={styles.castArrow}>
														<Icon name="chevron-right" size={14} />
													</span>
													<FavoriteButton
														entityType="person"
														tmdbId={member.tmdbId}
														name={member.name}
														profileUrl={member.profileUrl}
														personRole="actor"
														size="normal"
														stopPropagation
														revealOnHover
													/>
												</div>
											</a>
										);
									})}
								</div>
							</div>
						)}

						{/* Comments */}
						<div class={styles.fileInfoSection}>
							<button
								class={styles.fileInfoToggle}
								onClick={() => setShowComments(!showComments)}
							>
								<h2 class={styles.sectionTitle}>
									Comments
									{countComments(movie.id) > 0
										? ` (${countComments(movie.id)})`
										: ''}
								</h2>
								<span class={styles.fileInfoArrow}>
									<Icon
										name={showComments ? 'chevron-up' : 'chevron-down'}
										size={14}
									/>
								</span>
							</button>
							{showComments && (
								<div class={styles.fileInfoContent}>
									<CommentsPanel movieId={movie.id} />
								</div>
							)}
						</div>

						{/* Playlists */}
						<div class={styles.fileInfoSection}>
							<button
								class={styles.fileInfoToggle}
								onClick={() => setShowPlaylists(!showPlaylists)}
							>
								<h2 class={styles.sectionTitle}>
									Playlists{playlistCount > 0 ? ` (${playlistCount})` : ''}
								</h2>
								<span class={styles.fileInfoArrow}>
									<Icon
										name={showPlaylists ? 'chevron-up' : 'chevron-down'}
										size={14}
									/>
								</span>
							</button>
							{showPlaylists && (
								<MoviePlaylists
									movieId={movie.id}
									hideTitle
									onCountChange={setPlaylistCount}
									remoteInfo={
										isRemote && movie.remoteOrigin
											? {
													title: movie.title,
													posterUrl: movie.posterUrl,
													serverId: movie.remoteOrigin.serverId,
												}
											: undefined
									}
								/>
							)}
						</div>

						{/* Play Settings (local only) */}
						{!isRemote && (
							<div class={styles.fileInfoSection}>
								<button
									class={styles.fileInfoToggle}
									onClick={() => setShowPlaySettings(!showPlaySettings)}
								>
									<h2 class={styles.sectionTitle}>Play Settings</h2>
									<span class={styles.fileInfoArrow}>
										<Icon
											name={showPlaySettings ? 'chevron-up' : 'chevron-down'}
											size={14}
										/>
									</span>
								</button>

								{showPlaySettings && (
									<div class={styles.fileInfoContent}>
										<p class={styles.playSettingsDescription}>
											Override default audio settings when playing this movie.
										</p>
										<div class={styles.playSettingsGrid}>
											<label class={styles.playSettingsLabel}>
												EQ Profile
											</label>
											<Select
												value={selectedEqProfile}
												onChange={(val) => {
													setSelectedEqProfile(val);
													updatePlaySetting('eqProfileId', val || null);
												}}
												options={[
													{ value: '', label: 'None (use default)' },
													...audioProfiles
														.filter(
															(p) =>
																p.type === 'eq' ||
																p.type === 'full',
														)
														.map((p) => ({
															value: p.id,
															label: p.name,
														})),
												]}
											/>

											<label class={styles.playSettingsLabel}>
												Compressor Profile
											</label>
											<Select
												value={selectedCompProfile}
												onChange={(val) => {
													setSelectedCompProfile(val);
													updatePlaySetting(
														'compressorProfileId',
														val || null,
													);
												}}
												options={[
													{ value: '', label: 'None (use default)' },
													...audioProfiles
														.filter(
															(p) =>
																p.type === 'compressor' ||
																p.type === 'full',
														)
														.map((p) => ({
															value: p.id,
															label: p.name,
														})),
												]}
											/>

											<label class={styles.playSettingsLabel}>
												Video Profile
											</label>
											<Select
												value={selectedVideoProfile}
												onChange={(val) => {
													setSelectedVideoProfile(val);
													updatePlaySetting(
														'videoProfileId',
														val || null,
													);
												}}
												options={[
													{ value: '', label: 'None (use default)' },
													...audioProfiles
														.filter((p) => p.type === 'video')
														.map((p) => ({
															value: p.id,
															label: p.name,
														})),
												]}
											/>
										</div>
									</div>
								)}
							</div>
						)}

						{/* File Info (local only) */}
						{!isRemote && movie.fileInfo && (
							<div class={styles.fileInfoSection}>
								<button
									class={styles.fileInfoToggle}
									onClick={() => setShowFileInfo(!showFileInfo)}
								>
									<h2 class={styles.sectionTitle}>File Info</h2>
									<PlaybackBadge movie={movie} />
									<span class={styles.fileInfoArrow}>
										<Icon
											name={showFileInfo ? 'chevron-up' : 'chevron-down'}
											size={14}
										/>
									</span>
								</button>

								{showFileInfo && (
									<div class={styles.fileInfoContent}>
										<FileInfoGrid
											movie={movie}
											onCacheDeleted={() => {
												moviesService
													.get(id!)
													.then(setMovie)
													.catch(() => {});
											}}
										/>

										{/* Subtitles */}
										<div class={styles.trackSection}>
											<button
												class={styles.subtitleToggle}
												onClick={() => setShowSubtitles(!showSubtitles)}
											>
												{movie.fileInfo.subtitleTracks.length > 0
													? `${movie.fileInfo.subtitleTracks.length} subtitle${movie.fileInfo.subtitleTracks.length === 1 ? '' : 's'} found`
													: 'No subtitles found'}
												<span class={styles.fileInfoArrow}>
													<Icon
														name={
															showSubtitles
																? 'chevron-up'
																: 'chevron-down'
														}
														size={14}
													/>
												</span>
											</button>
											{showSubtitles && (
												<div class={styles.subtitlePanelWrap}>
													<SubtitlePanel
														movieId={movie.id}
														fileName={
															movie.fileInfo?.fileName ?? undefined
														}
														existingTracks={(
															movie.fileInfo?.subtitleTracks ?? []
														).map((t) => ({
															index: t.index,
															language: t.language || 'und',
															label:
																t.title ||
																t.language ||
																`Track ${t.index}`,
															codec: t.codec,
															forced: t.forced,
															external: t.external,
														}))}
														onSubtitlesChanged={async () => {
															const data = await moviesService.get(
																movie.id,
															);
															setMovie(data);
														}}
													/>
												</div>
											)}
										</div>
									</div>
								)}
							</div>
						)}

						<PluginSlot name={UI.MOVIE_PAGE_CONTENT} context={{ movie }} />
					</div>
				</div>
			</div>
			{movie && (
				<ShareMovieModal
					movieId={movie.id}
					movieTitle={movie.title}
					isOpen={showShareModal}
					onClose={() => setShowShareModal(false)}
				/>
			)}
		</div>
	);
}

/**
 * Preview-mode action bar shown when the movie isn't playable from
 * this server (source = 'external' or 'bookmark'). Replaces the Play
 * / Watchlist / Share trio with a Bookmark toggle.
 */
function PreviewActions({ movie }: { movie: Movie }) {
	const initialBookmarked = movie.source === 'bookmark';
	const [bookmarked, setBookmarked] = useState<boolean>(initialBookmarked);
	const [busy, setBusy] = useState(false);

	const toggle = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		try {
			if (bookmarked) {
				await bookmarksService.remove(movie.id);
				setBookmarked(false);
				notifySuccess(`Removed bookmark: ${movie.title}`);
			} else {
				await bookmarksService.add({
					tmdbId: movie.tmdbId ?? null,
					imdbId: movie.imdbId ?? null,
					title: movie.title,
					year: movie.year ?? null,
				});
				setBookmarked(true);
				notifySuccess(`Bookmarked: ${movie.title}`);
			}
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed');
		} finally {
			setBusy(false);
		}
	}, [bookmarked, busy, movie]);

	return (
		<>
			<span class={styles.previewBadge}>
				<Icon name="search" size={12} /> Preview · Not in library
			</span>
			<Button
				variant={bookmarked ? 'secondary' : 'primary'}
				size="lg"
				onClick={toggle}
				disabled={busy}
			>
				{bookmarked ? (
					<>
						<Icon name="check" size={14} /> Bookmarked
					</>
				) : (
					<>
						<Icon name="star" size={14} /> Bookmark for later
					</>
				)}
			</Button>
			{movie.tmdbId != null && (
				<Button
					variant="ghost"
					size="lg"
					onClick={() => {
						window.open(
							`https://www.themoviedb.org/movie/${movie.tmdbId}`,
							'_blank',
							'noopener,noreferrer',
						);
					}}
				>
					<Icon name="share" size={14} /> View on TMDB
				</Button>
			)}
		</>
	);
}

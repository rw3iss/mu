import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { ExternalRatings } from '@/components/movie/ExternalRatings';
import { MovieOptionsMenu } from '@/components/movie/MovieOptionsMenu';
import { MoviePlaylists } from '@/components/movie/MoviePlaylists';
import { RatingWidget } from '@/components/movie/RatingWidget';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { moviesService } from '@/services/movies.service';
import { playMovie } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
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

	// Inline title editing
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState('');
	const [isSavingTitle, setIsSavingTitle] = useState(false);
	const titleInputRef = useRef<HTMLInputElement>(null);

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
	}, [id]);

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

	const handleMovieUpdate = useCallback((updated: Movie) => {
		setMovie(updated);
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

			{/* Back button */}
			<button
				class={styles.backButton}
				onClick={() => route('/library')}
				aria-label="Back to Library"
			>
				{'\u2190'} Library
			</button>

			{/* Content */}
			<div class={styles.content}>
				{/* Poster */}
				<div class={styles.posterColumn}>
					{movie.posterUrl ? (
						<img
							src={movie.posterUrl}
							alt={`${movie.title} poster`}
							class={styles.poster}
						/>
					) : (
						<div class={styles.posterPlaceholder}>{(movie.title ?? '?').charAt(0)}</div>
					)}
				</div>

				{/* Info */}
				<div class={styles.infoColumn}>
					{/* Editable Title */}
					{editingTitle ? (
						<div class={styles.titleEditRow}>
							<input
								ref={titleInputRef}
								type="text"
								class={styles.titleInput}
								value={titleDraft}
								onInput={(e) => setTitleDraft((e.target as HTMLInputElement).value)}
								onKeyDown={handleTitleKeyDown}
								disabled={isSavingTitle}
							/>
							<button
								class={styles.titleSaveBtn}
								onClick={saveTitle}
								disabled={isSavingTitle}
								aria-label="Save title"
							>
								{isSavingTitle ? '\u2026' : '\u2713'}
							</button>
							<button
								class={styles.titleCancelBtn}
								onClick={cancelEditingTitle}
								disabled={isSavingTitle}
								aria-label="Cancel editing"
							>
								{'\u2715'}
							</button>
						</div>
					) : (
						<div class={styles.titleRow} onClick={startEditingTitle}>
							<h1 class={styles.title}>{movie.title}</h1>
							<span class={styles.titleEditIcon}>{'\u270E'}</span>
						</div>
					)}

					<div class={styles.meta}>
						{movie.year > 0 && <span>{movie.year}</span>}
						{movie.hidden && <span class={styles.hiddenBadge}>Hidden</span>}
						{runtimeText && <span>{runtimeText}</span>}
						{movie.director && <span>Dir. {movie.director}</span>}
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
						<div class={styles.userRating}>
							<span class={styles.ratingLabel}>Your Rating</span>
							<RatingWidget
								value={movie.rating}
								editable
								onChange={handleRate}
								size="lg"
							/>
						</div>
						<ExternalRatings
							imdbRating={movie.imdbRating}
							rtRating={movie.rtRating}
							metacriticRating={movie.metacriticRating}
						/>
						<PluginSlot name={UI.MOVIE_PAGE_RATING} context={{ movie }} />
					</div>

					{/* Actions */}
					<div class={styles.actions}>
						{movie.status === 'processing' ? (
							<div class={styles.processingStatus}>
								<Spinner size="sm" />
								<span>Processing...</span>
								<Button variant="ghost" size="lg" onClick={handleCancelProcessing}>
									{'\u2715'} Cancel
								</Button>
							</div>
						) : hasWatchProgress(movie) ? (
							<div class={styles.playGroup}>
								<div class={styles.hybridBtn}>
									<button
										class={styles.hybridPlay}
										onClick={handlePlay}
										aria-label="Play from beginning"
									>
										{'\u25B6'}
									</button>
									<button class={styles.hybridResume} onClick={handleResume}>
										Resume
									</button>
								</div>
								<div class={styles.playProgressBar}>
									<div
										class={styles.playProgressFill}
										style={{ width: `${getWatchPercent(movie)}%` }}
									/>
								</div>
							</div>
						) : (
							<Button variant="primary" size="lg" onClick={handlePlay}>
								{'\u25B6'} Play
							</Button>
						)}
						<Button
							variant={inWatchlist ? 'secondary' : 'ghost'}
							size="lg"
							onClick={handleWatchlistToggle}
						>
							{inWatchlist ? '\u2713 In Watchlist' : '\u2606 Watchlist'}
						</Button>
						<MovieOptionsMenu movie={movie} onMovieUpdate={handleMovieUpdate} />
					</div>

					{/* Overview */}
					{movie.overview && (
						<div class={styles.overviewSection}>
							<h2 class={styles.sectionTitle}>Overview</h2>
							<p class={styles.overview}>{movie.overview}</p>
						</div>
					)}

					{/* Cast */}
					{movie.cast && movie.cast.length > 0 && (
						<div class={styles.castSection}>
							<h2 class={styles.sectionTitle}>Cast</h2>
							<div class={styles.castGrid}>
								{movie.cast.slice(0, 12).map((member) => (
									<div key={member.name} class={styles.castMember}>
										<div class={styles.castAvatar}>
											{member.profileUrl ? (
												<img src={member.profileUrl} alt={member.name} />
											) : (
												<span>{member.name.charAt(0)}</span>
											)}
										</div>
										<div class={styles.castInfo}>
											<span class={styles.castName}>{member.name}</span>
											<span class={styles.castCharacter}>
												{member.character}
											</span>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* File Info */}
					{movie.fileInfo && (
						<div class={styles.fileInfoSection}>
							<button
								class={styles.fileInfoToggle}
								onClick={() => setShowFileInfo(!showFileInfo)}
							>
								<h2 class={styles.sectionTitle}>File Info</h2>
								<span class={styles.fileInfoArrow}>
									{showFileInfo ? '\u25B2' : '\u25BC'}
								</span>
							</button>

							{showFileInfo && (
								<div class={styles.fileInfoContent}>
									<div class={styles.fileInfoGrid}>
										{movie.fileInfo.fileName && (
											<>
												<span class={styles.fileInfoLabel}>File</span>
												<span class={styles.fileInfoValue}>
													{movie.fileInfo.fileName}
												</span>
											</>
										)}
										{movie.fileInfo.containerFormat && (
											<>
												<span class={styles.fileInfoLabel}>Container</span>
												<span class={styles.fileInfoValue}>
													{movie.fileInfo.containerFormat}
												</span>
											</>
										)}
										{(movie.fileInfo.videoWidth ||
											movie.fileInfo.resolution) && (
											<>
												<span class={styles.fileInfoLabel}>Resolution</span>
												<span class={styles.fileInfoValue}>
													{movie.fileInfo.videoWidth &&
													movie.fileInfo.videoHeight
														? `${movie.fileInfo.videoWidth}x${movie.fileInfo.videoHeight}`
														: ''}{' '}
													{movie.fileInfo.resolution
														? `(${movie.fileInfo.resolution})`
														: ''}
												</span>
											</>
										)}
										{movie.fileInfo.codecVideo && (
											<>
												<span class={styles.fileInfoLabel}>
													Video Codec
												</span>
												<span class={styles.fileInfoValue}>
													{movie.fileInfo.codecVideo.toUpperCase()}
													{movie.fileInfo.videoProfile
														? ` ${movie.fileInfo.videoProfile}`
														: ''}
												</span>
											</>
										)}
										{movie.fileInfo.videoBitDepth && (
											<>
												<span class={styles.fileInfoLabel}>Bit Depth</span>
												<span class={styles.fileInfoValue}>
													{movie.fileInfo.videoBitDepth}-bit
													{movie.fileInfo.hdr && (
														<span class={styles.fileInfoBadge}>
															HDR
														</span>
													)}
												</span>
											</>
										)}
										{movie.fileInfo.videoFrameRate && (
											<>
												<span class={styles.fileInfoLabel}>Frame Rate</span>
												<span class={styles.fileInfoValue}>
													{parseFloat(
														movie.fileInfo.videoFrameRate,
													).toFixed(
														Number.isInteger(
															parseFloat(
																movie.fileInfo.videoFrameRate,
															),
														)
															? 0
															: 3,
													)}{' '}
													fps
												</span>
											</>
										)}
										{movie.fileInfo.bitrate && movie.fileInfo.bitrate > 0 && (
											<>
												<span class={styles.fileInfoLabel}>Bitrate</span>
												<span class={styles.fileInfoValue}>
													{(movie.fileInfo.bitrate / 1_000_000).toFixed(
														1,
													)}{' '}
													Mbps
												</span>
											</>
										)}
										{movie.fileInfo.fileSize && movie.fileInfo.fileSize > 0 && (
											<>
												<span class={styles.fileInfoLabel}>File Size</span>
												<span class={styles.fileInfoValue}>
													{movie.fileInfo.fileSize > 1_073_741_824
														? `${(movie.fileInfo.fileSize / 1_073_741_824).toFixed(2)} GB`
														: `${(movie.fileInfo.fileSize / 1_048_576).toFixed(0)} MB`}
												</span>
											</>
										)}
										{movie.fileInfo.videoColorSpace && (
											<>
												<span class={styles.fileInfoLabel}>
													Color Space
												</span>
												<span class={styles.fileInfoValue}>
													{movie.fileInfo.videoColorSpace}
												</span>
											</>
										)}
									</div>

									{movie.fileInfo.audioTracks.length > 0 && (
										<div class={styles.trackSection}>
											<h3 class={styles.trackTitle}>
												Audio Tracks ({movie.fileInfo.audioTracks.length})
											</h3>
											<div class={styles.trackList}>
												{movie.fileInfo.audioTracks.map((t) => (
													<div key={t.index} class={styles.trackItem}>
														<span class={styles.trackCodec}>
															{t.codec.toUpperCase()}
														</span>
														<span class={styles.trackMeta}>
															{t.channelLayout ||
																(t.channels
																	? `${t.channels}ch`
																	: '')}
														</span>
														<span class={styles.trackLang}>
															{t.language !== 'und'
																? t.language?.toUpperCase()
																: ''}
														</span>
														{t.title &&
															t.title !== `Track ${t.index + 1}` && (
																<span
																	class={styles.trackExtraTitle}
																>
																	{t.title}
																</span>
															)}
													</div>
												))}
											</div>
										</div>
									)}

									{movie.fileInfo.subtitleTracks.length > 0 && (
										<div class={styles.trackSection}>
											<h3 class={styles.trackTitle}>
												Subtitle Tracks (
												{movie.fileInfo.subtitleTracks.length})
											</h3>
											<div class={styles.trackList}>
												{movie.fileInfo.subtitleTracks.map((t) => (
													<div key={t.index} class={styles.trackItem}>
														{t.codec && (
															<span class={styles.trackCodec}>
																{t.codec.toUpperCase()}
															</span>
														)}
														<span class={styles.trackLang}>
															{t.language !== 'und'
																? t.language?.toUpperCase()
																: 'Unknown'}
														</span>
														{t.forced && (
															<span
																class={`${styles.fileInfoBadge} ${styles.fileInfoBadgeMuted}`}
															>
																Forced
															</span>
														)}
														{t.external && (
															<span
																class={`${styles.fileInfoBadge} ${styles.fileInfoBadgeMuted}`}
															>
																External
															</span>
														)}
													</div>
												))}
											</div>
										</div>
									)}
								</div>
							)}
						</div>
					)}

					<PluginSlot name={UI.MOVIE_PAGE_CONTENT} context={{ movie }} />
				</div>

				{/* Playlists (right column) */}
				<div class={styles.playlistsColumn}>
					<MoviePlaylists movieId={movie.id} />
				</div>
			</div>
		</div>
	);
}

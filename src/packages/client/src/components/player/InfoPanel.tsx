import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { CommentsPanel } from '@/components/comments/CommentsPanel';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { CastPhoto } from '@/components/movie/CastPhoto';
import { FileInfoGrid } from '@/components/movie/FileInfoGrid';
import { MovieBreadcrumbs } from '@/components/movie/MovieBreadcrumbs';
import { PlaybackBadge } from '@/components/movie/PlaybackBadge';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { moviesService } from '@/services/movies.service';
import { wsService } from '@/services/websocket.service';
import { personKeyFor } from '@/state/favorites.state';
import { globalMovie, minimizePlayer, playerMode } from '@/state/globalPlayer.state';
import type { Movie } from '@/state/library.state';
import { showInfoPanel } from '@/state/player.state';
import { shareMode } from '@/state/share.state';
import { relativeTime } from '@/utils/time-format';
import styles from './InfoPanel.module.scss';

interface InfoPanelProps {
	movie: Movie | null;
	visible: boolean;
	onClose: () => void;
	/** When true, renders content inline (no backdrop, no close button, no slide animation) */
	inline?: boolean;
}

export function InfoPanel({ movie, visible, onClose, inline }: InfoPanelProps) {
	const [showFileInfo, setShowFileInfo] = useState(false);
	const [showComments, setShowComments] = useState(false);
	const [showCast, setShowCast] = useState(true);
	// "Load all" cast expansion — full list fetched (and persisted) on demand.
	const [fullCast, setFullCast] = useState<NonNullable<Movie['cast']> | null>(null);
	const [loadingCast, setLoadingCast] = useState(false);
	useEffect(() => {
		setFullCast(null);
	}, [movie?.id]);

	const handleLoadAllCast = async () => {
		if (!movie || loadingCast) return;
		// Show everything we already have; only hit the API to backfill rows
		// saved under the legacy 20-cast ingest cap.
		setFullCast(movie.cast ?? []);
		if ((movie.cast?.length ?? 0) !== 20) return;
		setLoadingCast(true);
		try {
			const r = await moviesService.loadFullCast(movie.id);
			if (r.cast.length > (movie.cast?.length ?? 0)) {
				setFullCast(r.cast as NonNullable<Movie['cast']>);
			}
		} catch {
			// non-critical
		} finally {
			setLoadingCast(false);
		}
	};

	// Refresh movie data when panel opens or when movie is updated via WebSocket
	useEffect(() => {
		if (!visible || !movie?.id) return;

		// Fetch latest data when panel becomes visible
		moviesService
			.get(movie.id)
			.then((updated) => {
				globalMovie.value = updated;
			})
			.catch(() => {});

		// Listen for updates (metadata refresh, rescan, etc.)
		const handler = (data: unknown) => {
			const event = data as { movieId?: string };
			if (event.movieId === movie.id) {
				moviesService
					.get(movie.id)
					.then((updated) => {
						globalMovie.value = updated;
					})
					.catch(() => {});
			}
		};
		wsService.on('library:movie-updated', handler);
		return () => wsService.off('library:movie-updated', handler);
	}, [visible, movie?.id]);

	if (!movie) return null;

	const hours = Math.floor((movie.runtime ?? 0) / 60);
	const minutes = (movie.runtime ?? 0) % 60;
	const runtimeText = movie.runtime ? `${hours > 0 ? `${hours}h ` : ''}${minutes}m` : '';

	return (
		<>
			{/* Backdrop overlay — not shown in inline mode */}
			{!inline && visible && <div class={styles.backdrop} onClick={onClose} />}

			<div
				class={`${inline ? styles.inlinePanel : styles.panel} ${!inline && visible ? styles.open : ''}`}
				data-player-panel
			>
				{!inline && (
					<button class={styles.closeBtn} onClick={onClose} aria-label="Close info">
						<Icon name="x" />
					</button>
				)}

				{inline ? (
					/* Inline: two-column layout — poster left, ALL content right */
					<div class={styles.inlineLayout}>
						<div class={styles.inlinePoster}>
							<SmartImage
								src={movie.posterUrl}
								alt={`${movie.title} poster`}
								imgClass={styles.inlinePosterImg}
								fallbackLabel={movie.title}
							/>
						</div>
						<div class={styles.inlineContent}>
							<div class={styles.titleRow}>
								{shareMode.value ? (
									<h2 class={styles.title}>{movie.title}</h2>
								) : (
									<h2
										class={`${styles.title} ${styles.titleLink}`}
										onClick={() => route(`/movie/${movie.id}`)}
									>
										{movie.title}
									</h2>
								)}
								<FavoriteButton
									entityType="movie"
									movieId={movie.id}
									size="normal"
									stopPropagation
								/>
							</div>
							<div class={styles.meta}>
								{movie.year > 0 && <span>{movie.year}</span>}
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
											overlayReveal
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

							{movie.genres && movie.genres.length > 0 && (
								<div class={styles.genres}>
									{movie.genres.map((genre) => (
										<span key={genre} class={styles.genreTag}>
											{genre}
										</span>
									))}
								</div>
							)}

							<div class={styles.ratings}>
								{movie.rating != null && movie.rating > 0 && (
									<div class={styles.ratingItem}>
										<span class={styles.ratingSource}>You</span>
										<span class={styles.ratingValue}>
											{movie.rating.toFixed(1)}
										</span>
									</div>
								)}
								{movie.imdbRating != null && movie.imdbRating > 0 ? (
									<a
										href={
											movie.imdbId
												? `https://www.imdb.com/title/${movie.imdbId}/`
												: undefined
										}
										target="_blank"
										rel="noopener noreferrer"
										class={`${styles.ratingItem} ${movie.imdbId ? styles.ratingLink : ''}`}
									>
										<span class={styles.ratingSource}>IMDb</span>
										<span class={styles.ratingValue}>{movie.imdbRating}</span>
									</a>
								) : movie.imdbId ? (
									<a
										href={`https://www.imdb.com/title/${movie.imdbId}/`}
										target="_blank"
										rel="noopener noreferrer"
										class={`${styles.ratingItem} ${styles.ratingLink}`}
									>
										<span class={styles.ratingSource}>IMDb</span>
									</a>
								) : null}
								{movie.rtRating != null && movie.rtRating > 0 && (
									<div class={styles.ratingItem}>
										<span class={styles.ratingSource}>RT</span>
										<span class={styles.ratingValue}>{movie.rtRating}%</span>
									</div>
								)}
								{movie.metacriticRating != null && movie.metacriticRating > 0 && (
									<div class={styles.ratingItem}>
										<span class={styles.ratingSource}>Metacritic</span>
										<span class={styles.ratingValue}>
											{movie.metacriticRating}
										</span>
									</div>
								)}
								{movie.imdbVotes != null && movie.imdbVotes > 0 && (
									<span class={styles.votesLabel} title="IMDb votes">
										{movie.imdbVotes >= 1000000
											? `${(movie.imdbVotes / 1000000).toFixed(1)}M`
											: movie.imdbVotes >= 1000
												? `${(movie.imdbVotes / 1000).toFixed(1)}K`
												: String(movie.imdbVotes)}{' '}
										votes
									</span>
								)}
							</div>

							{movie.overview && (
								<div class={styles.section}>
									<h3 class={styles.sectionTitle}>Overview</h3>
									<p class={styles.overview}>{movie.overview}</p>
								</div>
							)}

							{movie.cast && movie.cast.length > 0 && (
								<div class={styles.section}>
									<button
										class={styles.fileInfoToggle}
										onClick={() => setShowCast(!showCast)}
									>
										<h3 class={styles.sectionTitle}>Cast</h3>
										<span class={styles.fileInfoArrow}>
											<Icon
												name={showCast ? 'chevron-up' : 'chevron-down'}
												size={14}
											/>
										</span>
									</button>
									<div
										class={styles.castList}
										style={{ display: showCast ? '' : 'none' }}
									>
										{(fullCast ?? movie.cast.slice(0, 8)).map((member) => {
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
														size={36}
														expandedSize={180}
														thumbClass={styles.castPhoto}
													/>
													<div class={styles.castInfo}>
														<span class={styles.castName}>
															{member.name}
														</span>
														{member.character && (
															<span class={styles.castCharacter}>
																{member.character}
															</span>
														)}
													</div>
													<div class={styles.castActions}>
														<span class={styles.castArrow}>
															<Icon name="chevron-right" size={12} />
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
										{!fullCast && movie.cast.length > 8 && (
											<button
												class={styles.loadAllCast}
												disabled={loadingCast}
												onClick={handleLoadAllCast}
											>
												{loadingCast ? 'Loading…' : 'Load all'}
											</button>
										)}
									</div>
								</div>
							)}

							<div class={styles.section}>
								<button
									class={styles.fileInfoToggle}
									onClick={() => setShowComments(!showComments)}
								>
									<h3 class={styles.sectionTitle}>Comments</h3>
									<span class={styles.fileInfoArrow}>
										<Icon
											name={showComments ? 'chevron-up' : 'chevron-down'}
											size={14}
										/>
									</span>
								</button>
								{showComments && <CommentsPanel movieId={movie.id} />}
							</div>

							{movie.fileInfo && (
								<div class={styles.section}>
									<button
										class={styles.fileInfoToggle}
										onClick={() => setShowFileInfo(!showFileInfo)}
									>
										<h3 class={styles.sectionTitle}>File Info</h3>
										<PlaybackBadge movie={movie} />
										<span class={styles.fileInfoArrow}>
											<Icon
												name={showFileInfo ? 'chevron-up' : 'chevron-down'}
												size={14}
											/>
										</span>
									</button>
									{showFileInfo && <FileInfoGrid movie={movie} dark />}
								</div>
							)}
						</div>
					</div>
				) : (
					<>
						<div class={styles.poster}>
							<SmartImage
								src={movie.posterUrl}
								alt={`${movie.title} poster`}
								imgClass={styles.posterImg}
								fallbackLabel={movie.title}
							/>
						</div>

						<div class={styles.titleRow}>
							{shareMode.value ? (
								<h2 class={styles.title}>{movie.title}</h2>
							) : (
								<h2
									class={`${styles.title} ${styles.titleLink}`}
									onClick={() => {
										route(`/movie/${movie.id}`);
										if (playerMode.value === 'full') {
											minimizePlayer();
										}
										showInfoPanel.value = false;
									}}
								>
									{movie.title}
								</h2>
							)}
							<FavoriteButton
								entityType="movie"
								movieId={movie.id}
								size="normal"
								stopPropagation
							/>
						</div>

						<div class={styles.meta}>
							{movie.year > 0 && <span>{movie.year}</span>}
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
										overlayReveal
									/>
								</span>
							)}
						</div>

						{movie.addedAt && (
							<div class={styles.addedRow}>
								<span
									class={styles.addedAt}
									title={new Date(movie.addedAt).toLocaleString()}
								>
									Added {relativeTime(movie.addedAt)}
								</span>
							</div>
						)}

						{movie.genres && movie.genres.length > 0 && (
							<div class={styles.genres}>
								{movie.genres.map((genre) => (
									<span key={genre} class={styles.genreTag}>
										{genre}
									</span>
								))}
							</div>
						)}

						<div class={styles.ratings}>
							{movie.rating != null && movie.rating > 0 && (
								<div class={styles.ratingItem}>
									<span class={styles.ratingSource}>You</span>
									<span class={styles.ratingValue}>
										{movie.rating.toFixed(1)}
									</span>
								</div>
							)}
							{movie.imdbRating != null && movie.imdbRating > 0 ? (
								<a
									href={
										movie.imdbId
											? `https://www.imdb.com/title/${movie.imdbId}/`
											: undefined
									}
									target="_blank"
									rel="noopener noreferrer"
									class={`${styles.ratingItem} ${movie.imdbId ? styles.ratingLink : ''}`}
								>
									<span class={styles.ratingSource}>IMDb</span>
									<span class={styles.ratingValue}>{movie.imdbRating}</span>
								</a>
							) : movie.imdbId ? (
								<a
									href={`https://www.imdb.com/title/${movie.imdbId}/`}
									target="_blank"
									rel="noopener noreferrer"
									class={`${styles.ratingItem} ${styles.ratingLink}`}
								>
									<span class={styles.ratingSource}>IMDb</span>
								</a>
							) : null}
							{movie.rtRating != null && movie.rtRating > 0 && (
								<div class={styles.ratingItem}>
									<span class={styles.ratingSource}>RT</span>
									<span class={styles.ratingValue}>{movie.rtRating}%</span>
								</div>
							)}
							{movie.metacriticRating != null && movie.metacriticRating > 0 && (
								<div class={styles.ratingItem}>
									<span class={styles.ratingSource}>Metacritic</span>
									<span class={styles.ratingValue}>{movie.metacriticRating}</span>
								</div>
							)}
							{movie.imdbVotes != null && movie.imdbVotes > 0 && (
								<span class={styles.votesLabel} title="IMDb votes">
									{movie.imdbVotes >= 1000000
										? `${(movie.imdbVotes / 1000000).toFixed(1)}M`
										: movie.imdbVotes >= 1000
											? `${(movie.imdbVotes / 1000).toFixed(1)}K`
											: String(movie.imdbVotes)}{' '}
									votes
								</span>
							)}
						</div>

						{movie.overview && (
							<div class={styles.section}>
								<h3 class={styles.sectionTitle}>Overview</h3>
								<p class={styles.overview}>{movie.overview}</p>
							</div>
						)}

						{movie.cast && movie.cast.length > 0 && (
							<div class={styles.section}>
								<button
									class={styles.fileInfoToggle}
									onClick={() => setShowCast(!showCast)}
								>
									<h3 class={styles.sectionTitle}>Cast</h3>
									<span class={styles.fileInfoArrow}>
										<Icon
											name={showCast ? 'chevron-up' : 'chevron-down'}
											size={14}
										/>
									</span>
								</button>
								<div
									class={styles.castList}
									style={{ display: showCast ? '' : 'none' }}
								>
									{(fullCast ?? movie.cast.slice(0, 8)).map((member) => {
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
													size={36}
													expandedSize={180}
													thumbClass={styles.castPhoto}
												/>
												<div class={styles.castInfo}>
													<span class={styles.castName}>
														{member.name}
													</span>
													{member.character && (
														<span class={styles.castCharacter}>
															{member.character}
														</span>
													)}
												</div>
												<div class={styles.castActions}>
													<span class={styles.castArrow}>
														<Icon name="chevron-right" size={12} />
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
									{!fullCast && movie.cast.length > 8 && (
										<button
											class={styles.loadAllCast}
											disabled={loadingCast}
											onClick={handleLoadAllCast}
										>
											{loadingCast ? 'Loading…' : 'Load all'}
										</button>
									)}
								</div>
							</div>
						)}

						<div class={styles.section}>
							<button
								class={styles.fileInfoToggle}
								onClick={() => setShowComments(!showComments)}
							>
								<h3 class={styles.sectionTitle}>Comments</h3>
								<span class={styles.fileInfoArrow}>
									<Icon
										name={showComments ? 'chevron-up' : 'chevron-down'}
										size={14}
									/>
								</span>
							</button>
							{showComments && <CommentsPanel movieId={movie.id} />}
						</div>

						{movie.fileInfo && (
							<div class={styles.section}>
								<button
									class={styles.fileInfoToggle}
									onClick={() => setShowFileInfo(!showFileInfo)}
								>
									<h3 class={styles.sectionTitle}>File Info</h3>
									<PlaybackBadge movie={movie} />
									<span class={styles.fileInfoArrow}>
										<Icon
											name={showFileInfo ? 'chevron-up' : 'chevron-down'}
											size={14}
										/>
									</span>
								</button>
								{showFileInfo && <FileInfoGrid movie={movie} dark />}
							</div>
						)}
					</>
				)}

				{/* Plugin UI Slots */}
				<PluginSlot name={UI.INFO_PANEL} context={{ movie }} />
			</div>
		</>
	);
}

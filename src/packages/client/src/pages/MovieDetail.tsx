import { h } from 'preact';
import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { RatingWidget } from '@/components/movie/RatingWidget';
import { ExternalRatings } from '@/components/movie/ExternalRatings';
import { Spinner } from '@/components/common/Spinner';
import { moviesService } from '@/services/movies.service';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import type { Movie } from '@/state/library.state';
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
      // Replace so the player doesn't pollute the back-navigation stack
      route(`/player/${movie.id}`, true);
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
    [movie]
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

  const handleRefreshMetadata = useCallback(async () => {
    if (!movie) return;
    try {
      await moviesService.refreshMetadata(movie.id);
      // Reload movie data to show updated metadata
      const updated = await moviesService.get(movie.id);
      setMovie(updated);
      notifySuccess('Metadata refreshed');
    } catch {
      notifyError('Failed to refresh metadata');
    }
  }, [movie]);

  const handleRescan = useCallback(async () => {
    if (!movie) return;
    try {
      const result = await moviesService.rescan(movie.id);
      const updatedCount = result.files.filter((f) => f.updated).length;
      notifySuccess(`Re-scanned ${result.files.length} file(s), ${updatedCount} updated`);
    } catch {
      notifyError('Failed to re-scan movie files');
    }
  }, [movie]);

  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const handleRemove = useCallback(async () => {
    if (!movie) return;
    try {
      await moviesService.remove(movie.id);
      notifySuccess('Movie removed from library');
      route('/library');
    } catch {
      notifyError('Failed to remove movie');
    }
  }, [movie]);

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
    [saveTitle, cancelEditingTitle]
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
  const minutes = movie.runtime % 60;
  const runtimeText = movie.runtime
    ? `${hours > 0 ? `${hours}h ` : ''}${minutes}m`
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
        onClick={() => {
          // After going back, if we land on a player page, skip over it
          const onPop = () => {
            window.removeEventListener('popstate', onPop);
            if (window.location.pathname.startsWith('/player/')) {
              window.history.back();
            }
          };
          window.addEventListener('popstate', onPop);
          window.history.back();
        }}
        aria-label="Go back"
      >
        {'\u2190'} Back
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
            <div class={styles.posterPlaceholder}>
              {(movie.title ?? '?').charAt(0)}
            </div>
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
          </div>

          {/* Actions */}
          <div class={styles.actions}>
            <Button variant="primary" size="lg" onClick={handlePlay}>
              {'\u25B6'} Play
            </Button>
            <Button
              variant={inWatchlist ? 'secondary' : 'ghost'}
              size="lg"
              onClick={handleWatchlistToggle}
            >
              {inWatchlist ? '\u2713 In Watchlist' : '\u2606 Watchlist'}
            </Button>
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
                      <span class={styles.castCharacter}>{member.character}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Management */}
          <div class={styles.managementSection}>
            <h2 class={styles.sectionTitle}>Manage</h2>
            <div class={styles.managementBar}>
              <button class={styles.mgmtBtn} onClick={handleRescan}>
                {'\u{1F50D}'} Re-scan File
              </button>
              <button class={styles.mgmtBtn} onClick={handleRefreshMetadata}>
                {'\u21BB'} Refresh Metadata
              </button>
              {confirmingRemove ? (
                <span class={styles.confirmRemove}>
                  <span>Remove from library?</span>
                  <button class={styles.confirmYes} onClick={handleRemove}>
                    Yes
                  </button>
                  <button
                    class={styles.confirmNo}
                    onClick={() => setConfirmingRemove(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  class={`${styles.mgmtBtn} ${styles.mgmtBtnDanger}`}
                  onClick={() => setConfirmingRemove(true)}
                >
                  {'\u2715'} Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

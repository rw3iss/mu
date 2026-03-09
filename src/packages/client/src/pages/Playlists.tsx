import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import { useUiSetting } from '@/hooks/useUiSetting';
import { route } from 'preact-router';
import type { Playlist, PlaylistMovieSummary } from '@/services/playlists.service';
import styles from './Playlists.module.scss';

type PlaylistSortBy = 'updated' | 'created' | 'name' | 'movieCount' | 'lastPlayed';
type PlaylistSortOrder = 'asc' | 'desc';
type PlaylistViewMode = 'grid' | 'list';

interface PlaylistsProps {
  path?: string;
}

/** Max movies to show in the 3x2 preview grid */
const PREVIEW_COUNT = 6;

function formatDuration(
  runtimeMinutes: number | null | undefined,
  durationSeconds: number | null | undefined,
): string {
  // Prefer precise file duration for short movies
  const totalSec = durationSeconds ?? (runtimeMinutes ? runtimeMinutes * 60 : 0);
  if (totalSec <= 0) return '';

  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);

  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (totalSec < 600) {
    // Under 10 minutes — show seconds too
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  return `${m}m`;
}

// ============================================
// Shared: Interactive movie poster with hover info
// ============================================

interface MoviePosterItemProps {
  movie: PlaylistMovieSummary;
  /** 'strip' = tooltip above (list view); 'grid' = overlay on poster (card view) */
  variant?: 'strip' | 'grid';
  class?: string;
}

function MoviePosterItem({ movie, variant = 'strip', class: className }: MoviePosterItemProps) {
  const poster = movie.posterUrl || movie.thumbnailUrl;

  const handleClick = useCallback(
    (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      route(`/movie/${movie.movieId}`);
    },
    [movie.movieId],
  );

  const variantClass = variant === 'grid' ? styles.posterItemGrid : styles.posterItemStrip;

  return (
    <div
      class={`${styles.posterItem} ${variantClass} ${className || ''}`}
      onClick={handleClick}
      role="link"
      tabIndex={0}
    >
      {poster ? (
        <img src={poster} alt={movie.title} loading="lazy" class={styles.posterImg} />
      ) : (
        <div class={styles.posterFallback}>
          <span>{movie.title.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div class={styles.posterInfo}>
        <div class={styles.posterInfoTitle}>{movie.title}</div>
        <div class={styles.posterInfoMeta}>
          {movie.year && <span>{movie.year}</span>}
          {(movie.durationSeconds || movie.runtimeMinutes) && (
            <span>{formatDuration(movie.runtimeMinutes, movie.durationSeconds)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Shared: Horizontal scrollable movie poster strip
// ============================================

function MovieStrip({ movies }: { movies: PlaylistMovieSummary[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [maxOffset, setMaxOffset] = useState(0);

  const recalc = useCallback(() => {
    const track = trackRef.current;
    const wrapper = wrapperRef.current;
    if (!track || !wrapper) return;
    const max = Math.max(0, track.scrollWidth - wrapper.clientWidth);
    setMaxOffset(max);
    setOffset((prev) => Math.min(prev, max));
  }, []);

  useEffect(() => {
    recalc();
  }, [movies]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(recalc);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  const scroll = useCallback(
    (dir: 'left' | 'right') => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const step = wrapper.clientWidth * 0.8;
      setOffset((prev) => {
        const next = dir === 'left' ? prev - step : prev + step;
        return Math.max(0, Math.min(next, maxOffset));
      });
    },
    [maxOffset],
  );

  const canScrollLeft = offset > 0;
  const canScrollRight = offset < maxOffset - 1;

  if (movies.length === 0) {
    return <div class={styles.stripEmpty}>No movies yet</div>;
  }

  return (
    <div class={styles.stripWrapper} ref={wrapperRef}>
      {canScrollLeft && (
        <button
          class={`${styles.stripArrow} ${styles.stripArrowLeft}`}
          onClick={(e) => {
            e.stopPropagation();
            scroll('left');
          }}
          aria-label="Scroll left"
        >
          {'\u2039'}
        </button>
      )}
      <div
        class={styles.stripTrack}
        ref={trackRef}
        style={{ transform: `translateX(-${offset}px)` }}
      >
        {movies.map((m) => (
          <MoviePosterItem key={m.movieId} movie={m} variant="strip" />
        ))}
      </div>
      {canScrollRight && (
        <button
          class={`${styles.stripArrow} ${styles.stripArrowRight}`}
          onClick={(e) => {
            e.stopPropagation();
            scroll('right');
          }}
          aria-label="Scroll right"
        >
          {'\u203A'}
        </button>
      )}
    </div>
  );
}

// ============================================
// Main Playlists page
// ============================================

export function Playlists(_props: PlaylistsProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [sortBy, setSortBy] = useUiSetting<PlaylistSortBy>('playlists_sort', 'updated');
  const [sortOrder, setSortOrder] = useUiSetting<PlaylistSortOrder>('playlists_sort_order', 'desc');
  const [viewMode, setViewMode] = useUiSetting<PlaylistViewMode>('playlists_view', 'grid');

  useEffect(() => {
    loadPlaylists(sortBy, sortOrder);
  }, [sortBy, sortOrder]);

  async function loadPlaylists(sort: PlaylistSortBy, order: PlaylistSortOrder) {
    setIsLoading(true);
    try {
      const data = await api.get<Playlist[]>(
        `/playlists?includeMovies=true&sortBy=${sort}&sortOrder=${order}`,
      );
      setPlaylists(data);
    } catch {
      console.error('Failed to load playlists');
    } finally {
      setIsLoading(false);
    }
  }

  const handleSortChange = useCallback((e: Event) => {
    setSortBy((e.target as HTMLSelectElement).value as PlaylistSortBy);
  }, []);

  const toggleSortOrder = useCallback(() => {
    setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
  }, [sortOrder]);

  const handleCreate = useCallback(
    async (e: Event) => {
      e.preventDefault();
      if (!newName.trim()) return;

      try {
        await api.post('/playlists', {
          name: newName.trim(),
          description: newDescription.trim(),
        });
        notifySuccess('Playlist created');
        setShowCreate(false);
        setNewName('');
        setNewDescription('');
        loadPlaylists(sortBy);
      } catch {
        notifyError('Failed to create playlist');
      }
    },
    [newName, newDescription],
  );

  if (isLoading) {
    return (
      <div class={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div class={styles.playlists}>
      <div class={styles.header}>
        <h1 class={styles.title}>Playlists</h1>
        <div class={styles.headerActions}>
          <select class={styles.sortSelect} value={sortBy} onChange={handleSortChange}>
            <option value="updated">Date Updated</option>
            <option value="created">Date Created</option>
            <option value="name">Name</option>
            <option value="movieCount">Number of Items</option>
            <option value="lastPlayed">Last Played</option>
          </select>
          <button
            class={styles.sortOrderBtn}
            onClick={toggleSortOrder}
            aria-label={sortOrder === 'desc' ? 'Sort descending' : 'Sort ascending'}
            title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
          >
            {sortOrder === 'desc' ? '\u2193' : '\u2191'}
          </button>
          <div class={styles.viewToggle}>
            <button
              class={`${styles.viewButton} ${viewMode === 'grid' ? styles.active : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              title="Grid"
            >
              {'\u25A6'}
            </button>
            <button
              class={`${styles.viewButton} ${viewMode === 'list' ? styles.active : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="List view"
              title="List"
            >
              {'\u2630'}
            </button>
          </div>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            + New Playlist
          </Button>
        </div>
      </div>

      {playlists.length === 0 ? (
        <div class={styles.empty}>
          <p>No playlists yet</p>
          <Button variant="secondary" onClick={() => setShowCreate(true)}>
            Create your first playlist
          </Button>
        </div>
      ) : viewMode === 'grid' ? (
        <div class={styles.grid}>
          {playlists.map((playlist) => {
            const previewMovies = (playlist.movies ?? []).slice(0, PREVIEW_COUNT);
            const hasMovies = previewMovies.length > 0;

            return (
              <div
                key={playlist.id}
                class={styles.card}
                onClick={() => route(`/playlists/${playlist.id}`)}
                role="button"
                tabIndex={0}
              >
                <div class={styles.cardPoster}>
                  {hasMovies ? (
                    <div class={styles.movieGrid}>
                      {previewMovies.map((m) => (
                        <MoviePosterItem key={m.movieId} movie={m} variant="grid" />
                      ))}
                      {Array.from({ length: PREVIEW_COUNT - previewMovies.length }).map((_, i) => (
                        <div key={`empty-${i}`} class={styles.movieTileEmpty} />
                      ))}
                    </div>
                  ) : (
                    <div class={styles.emptyPoster}>
                      <span class={styles.emptyIcon}>No movies yet</span>
                    </div>
                  )}
                </div>
                <div class={styles.cardInfo}>
                  <h3 class={styles.cardName}>{playlist.name}</h3>
                  {playlist.description && (
                    <p class={styles.cardDescription}>{playlist.description}</p>
                  )}
                  <span class={styles.cardCount}>
                    {playlist.movieCount} {playlist.movieCount === 1 ? 'movie' : 'movies'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div class={styles.list}>
          {playlists.map((playlist) => (
            <div key={playlist.id} class={styles.listItem}>
              <div class={styles.listItemHeader}>
                <h3
                  class={styles.listItemName}
                  onClick={() => route(`/playlists/${playlist.id}`)}
                  role="link"
                  tabIndex={0}
                >
                  {playlist.name}
                </h3>
                <span class={styles.listItemCount}>
                  {playlist.movieCount} {playlist.movieCount === 1 ? 'movie' : 'movies'}
                </span>
              </div>
              <MovieStrip movies={playlist.movies ?? []} />
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Playlist"
        size="sm"
      >
        <form
          onSubmit={handleCreate}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 'var(--font-size-sm)',
                marginBottom: 'var(--space-xs)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Name
            </label>
            <input
              type="text"
              value={newName}
              onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
              placeholder="Playlist name"
              style={{
                width: '100%',
                padding: 'var(--space-sm) var(--space-md)',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--font-size-md)',
              }}
              autoFocus
              required
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 'var(--font-size-sm)',
                marginBottom: 'var(--space-xs)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Description
            </label>
            <textarea
              value={newDescription}
              onInput={(e) => setNewDescription((e.target as HTMLTextAreaElement).value)}
              placeholder="Optional description"
              rows={3}
              style={{
                width: '100%',
                padding: 'var(--space-sm) var(--space-md)',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--font-size-md)',
                resize: 'vertical',
              }}
            />
          </div>
          <Button type="submit" variant="primary" fullWidth>
            Create
          </Button>
        </form>
      </Modal>
    </div>
  );
}

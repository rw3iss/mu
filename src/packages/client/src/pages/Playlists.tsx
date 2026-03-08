import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import { route } from 'preact-router';
import type { Playlist, PlaylistMovieSummary } from '@/services/playlists.service';
import styles from './Playlists.module.scss';

interface PlaylistsProps {
  path?: string;
}

/** Max movies to show in the 3x2 preview grid */
const PREVIEW_COUNT = 6;

function MovieTile({ movie }: { movie: PlaylistMovieSummary }) {
  const poster = movie.posterUrl || movie.thumbnailUrl;

  if (poster) {
    return <img class={styles.tilePoster} src={poster} alt={movie.title} />;
  }

  // Fallback: abbreviation + year
  const abbr = movie.title
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div class={styles.tileFallback}>
      <span class={styles.tileAbbr}>{abbr}</span>
      {movie.year && <span class={styles.tileYear}>{movie.year}</span>}
    </div>
  );
}

export function Playlists(_props: PlaylistsProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    loadPlaylists();
  }, []);

  async function loadPlaylists() {
    setIsLoading(true);
    try {
      const data = await api.get<Playlist[]>('/playlists?includeMovies=true');
      setPlaylists(data);
    } catch {
      console.error('Failed to load playlists');
    } finally {
      setIsLoading(false);
    }
  }

  const handleCreate = useCallback(async (e: Event) => {
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
      loadPlaylists();
    } catch {
      notifyError('Failed to create playlist');
    }
  }, [newName, newDescription]);

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
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          + New Playlist
        </Button>
      </div>

      {playlists.length === 0 ? (
        <div class={styles.empty}>
          <p>No playlists yet</p>
          <Button variant="secondary" onClick={() => setShowCreate(true)}>
            Create your first playlist
          </Button>
        </div>
      ) : (
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
                        <div key={m.movieId} class={styles.movieTile}>
                          <MovieTile movie={m} />
                        </div>
                      ))}
                      {/* Fill remaining cells if fewer than 6 */}
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
      )}

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Playlist"
        size="sm"
      >
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-xs)', color: 'var(--color-text-secondary)' }}>
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
            <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-xs)', color: 'var(--color-text-secondary)' }}>
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

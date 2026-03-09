import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { Movie } from '@/state/library.state';
import { pluginsService, type PluginUiSlotItem, type PluginUiContent } from '@/services/plugins.service';
import styles from './InfoPanel.module.scss';

interface InfoPanelProps {
  movie: Movie | null;
  visible: boolean;
  onClose: () => void;
}

function PluginUiRenderer({ items }: { items: PluginUiSlotItem[] }) {
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => (
        <div key={item.id} class={styles.section}>
          {item.content.map((block, i) => renderContentBlock(block, i))}
        </div>
      ))}
    </>
  );
}

function renderContentBlock(block: PluginUiContent, index: number) {
  switch (block.type) {
    case 'heading':
      return <h3 key={index} class={styles.sectionTitle}>{block.text}</h3>;
    case 'text':
      return <p key={index} class={styles.overview}>{block.text}</p>;
    case 'badge':
      return (
        <span
          key={index}
          class={styles.genreTag}
          style={block.color ? { backgroundColor: block.color, color: '#fff' } : undefined}
        >
          {block.label}
        </span>
      );
    case 'link':
      return (
        <a key={index} href={block.url} target="_blank" rel="noopener noreferrer">
          {block.text}
        </a>
      );
    case 'rating':
      return (
        <div key={index} class={styles.ratingItem}>
          <span class={styles.ratingSource}>{block.source}</span>
          <span class={styles.ratingValue}>
            {block.value}{block.max ? `/${block.max}` : ''}
          </span>
        </div>
      );
    case 'key-value':
      return (
        <div key={index} class={styles.meta}>
          <span>{block.label}: {block.value}</span>
        </div>
      );
    case 'list':
      return (
        <ul key={index}>
          {block.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      );
    case 'divider':
      return <hr key={index} />;
    default:
      return null;
  }
}

export function InfoPanel({ movie, visible, onClose }: InfoPanelProps) {
  const [pluginSlotItems, setPluginSlotItems] = useState<PluginUiSlotItem[]>([]);

  useEffect(() => {
    if (!movie || !visible) {
      setPluginSlotItems([]);
      return;
    }

    // Fetch plugin UI slot items for the INFO_PANEL
    // We try all discovered plugins' INFO_PANEL slots
    pluginsService.list().then((pluginsList) => {
      const enabledPlugins = pluginsList.filter((p) => p.enabled);
      const promises = enabledPlugins.map((p) =>
        pluginsService.getSlotItems(p.name, 'INFO_PANEL').catch(() => [] as PluginUiSlotItem[])
      );
      Promise.all(promises).then((results) => {
        const allItems = results.flat();
        allItems.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        setPluginSlotItems(allItems);
      });
    }).catch(() => {
      // Silently fail — plugins are optional
    });
  }, [movie, visible]);

  if (!movie) return null;

  const hours = Math.floor((movie.runtime ?? 0) / 60);
  const minutes = (movie.runtime ?? 0) % 60;
  const runtimeText = movie.runtime
    ? `${hours > 0 ? `${hours}h ` : ''}${minutes}m`
    : '';

  return (
    <>
      {/* Backdrop overlay */}
      {visible && <div class={styles.backdrop} onClick={onClose} />}

      <div class={`${styles.panel} ${visible ? styles.open : ''}`}>
        <button class={styles.closeBtn} onClick={onClose} aria-label="Close info">
          {'\u2715'}
        </button>

        {/* Poster */}
        {movie.posterUrl && (
          <img
            src={movie.posterUrl}
            alt={`${movie.title} poster`}
            class={styles.poster}
          />
        )}

        <h2 class={styles.title}>{movie.title}</h2>

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
          {movie.imdbRating != null && movie.imdbRating > 0 && (
            <div class={styles.ratingItem}>
              <span class={styles.ratingSource}>IMDb</span>
              <span class={styles.ratingValue}>{movie.imdbRating}</span>
            </div>
          )}
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
        </div>

        {/* Overview */}
        {movie.overview && (
          <div class={styles.section}>
            <h3 class={styles.sectionTitle}>Overview</h3>
            <p class={styles.overview}>{movie.overview}</p>
          </div>
        )}

        {/* Cast */}
        {movie.cast && movie.cast.length > 0 && (
          <div class={styles.section}>
            <h3 class={styles.sectionTitle}>Cast</h3>
            <div class={styles.castList}>
              {movie.cast.slice(0, 8).map((member) => (
                <div key={member.name} class={styles.castMember}>
                  <span class={styles.castName}>{member.name}</span>
                  {member.character && (
                    <span class={styles.castCharacter}>{member.character}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plugin UI Slot Items */}
        <PluginUiRenderer items={pluginSlotItems} />
      </div>
    </>
  );
}

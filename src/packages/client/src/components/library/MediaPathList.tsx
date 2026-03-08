import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import { MediaPathEntry } from './MediaPathEntry';
import type { MediaSourceDto } from '@/services/sources.service';
import styles from './MediaPathList.module.scss';

export interface MediaPathEntryData {
  path: string;
  source: MediaSourceDto | null;
}

interface MediaPathListProps {
  entries: MediaPathEntryData[];
  onChange: (entries: MediaPathEntryData[]) => void;
  showBrowse?: boolean;
}

export function MediaPathList({ entries, onChange, showBrowse = false }: MediaPathListProps) {
  const handlePathChange = useCallback(
    (index: number, path: string) => {
      const updated = [...entries];
      updated[index] = { ...updated[index], path };
      onChange(updated);
    },
    [entries, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      const updated = entries.filter((_, i) => i !== index);
      onChange(updated);
    },
    [entries, onChange]
  );

  const handleAdd = useCallback(() => {
    onChange([...entries, { path: '', source: null }]);
  }, [entries, onChange]);

  return (
    <div class={styles.list}>
      {entries.map((entry, i) => (
        <MediaPathEntry
          key={i}
          path={entry.path}
          source={entry.source}
          onPathChange={(path) => handlePathChange(i, path)}
          onRemove={() => handleRemove(i)}
          showBrowse={showBrowse}
        />
      ))}
      <button class={styles.addBtn} onClick={handleAdd}>
        + Add another folder
      </button>
    </div>
  );
}

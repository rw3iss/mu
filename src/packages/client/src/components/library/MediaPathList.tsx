import { useCallback } from 'preact/hooks';
import type { MediaSourceDto } from '@/services/sources.service';
import { sourcesService } from '@/services/sources.service';
import { MediaPathEntry } from './MediaPathEntry';
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
	// "Default" radio only matters with multiple saved sources; a single path
	// is implicitly the default.
	const savedCount = entries.filter((e) => e.source).length;
	const showDefault = savedCount > 1;

	const handleSetDefault = useCallback(
		async (index: number) => {
			const src = entries[index]?.source;
			if (!src) return;
			try {
				await sourcesService.update(src.id, { isDefault: true });
				// Reflect locally: set on this row, clear on the others.
				onChange(
					entries.map((e, i) => ({
						...e,
						source: e.source ? { ...e.source, isDefault: i === index } : e.source,
					})),
				);
			} catch {
				// non-critical; leave state as-is
			}
		},
		[entries, onChange],
	);
	const handlePathChange = useCallback(
		(index: number, path: string) => {
			const updated = [...entries];
			updated[index] = { ...updated[index], path };
			onChange(updated);
		},
		[entries, onChange],
	);

	const handleRemove = useCallback(
		(index: number) => {
			const updated = entries.filter((_, i) => i !== index);
			onChange(updated);
		},
		[entries, onChange],
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
					showDefault={showDefault}
					onSetDefault={() => handleSetDefault(i)}
				/>
			))}
			<button class={styles.addBtn} onClick={handleAdd}>
				+ Add another folder
			</button>
		</div>
	);
}

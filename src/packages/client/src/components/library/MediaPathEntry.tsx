import { useCallback, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { FolderBrowser } from '@/components/common/FolderBrowser';
import { Icon } from '@/components/common/Icon';
import { Radio } from '@/components/common/Radio';
import type { MediaSourceDto, ScanResult } from '@/services/sources.service';
import { sourcesService } from '@/services/sources.service';
import styles from './MediaPathEntry.module.scss';

interface MediaPathEntryProps {
	path: string;
	source?: MediaSourceDto | null;
	onPathChange: (path: string) => void;
	onRemove: () => void;
	showBrowse?: boolean;
	placeholder?: string;
	/** Render the "Default" radio column (only when multiple saved sources). */
	showDefault?: boolean;
	onSetDefault?: () => void;
}

function formatDate(iso: string | null): string {
	if (!iso) return 'Never';
	const d = new Date(iso);
	return d.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function MediaPathEntry({
	path,
	source,
	onPathChange,
	onRemove,
	showBrowse = false,
	placeholder = '/path/to/movies',
	showDefault = false,
	onSetDefault,
}: MediaPathEntryProps) {
	const [isBrowseOpen, setIsBrowseOpen] = useState(false);
	const [label, setLabel] = useState(source?.label ?? '');
	const [isScanning, setIsScanning] = useState(false);
	const [scanResult, setScanResult] = useState<ScanResult | null>(null);

	// Persist the label on blur (saved sources only — new rows get one after Save).
	const handleLabelBlur = useCallback(async () => {
		if (!source) return;
		const next = label.trim();
		if (next === (source.label ?? '')) return;
		try {
			await sourcesService.update(source.id, { label: next });
		} catch {
			// non-critical; next Save will retry
		}
	}, [source, label]);

	const handleScan = useCallback(async () => {
		if (!source) return;
		setIsScanning(true);
		setScanResult(null);
		try {
			const result = await sourcesService.scan(source.id);
			setScanResult(result);
		} catch {
			// error handled silently
		} finally {
			setIsScanning(false);
		}
	}, [source]);

	return (
		<div class={styles.entry}>
			<div class={styles.row}>
				{showDefault && (
					<Radio
						name="default-media-path"
						checked={!!source?.isDefault}
						disabled={!source}
						onChange={() => onSetDefault?.()}
						title="Use as the default media path (preselected for uploads)"
					/>
				)}
				{source && (
					<input
						type="text"
						class={styles.labelInput}
						value={label}
						onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
						onBlur={handleLabelBlur}
						placeholder="Label"
						title="Short display name for this media path"
					/>
				)}
				<input
					type="text"
					class={styles.input}
					value={path}
					onInput={(e) => onPathChange((e.target as HTMLInputElement).value)}
					placeholder={placeholder}
				/>
				{showBrowse && (
					<Button variant="secondary" size="sm" onClick={() => setIsBrowseOpen(true)}>
						Browse...
					</Button>
				)}
				{source && (
					<Button variant="secondary" size="sm" loading={isScanning} onClick={handleScan}>
						Scan
					</Button>
				)}
				<button class={styles.removeBtn} onClick={onRemove} aria-label="Remove path">
					<Icon name="x" size={14} />
				</button>
			</div>

			{source && (
				<div class={styles.meta}>
					{source.fileCount} file{source.fileCount === 1 ? '' : 's'} &middot; Last
					scanned: {formatDate(source.lastScannedAt)}
				</div>
			)}

			{scanResult && (
				<div class={styles.scanResult}>
					{scanResult.filesFound} found &middot; {scanResult.filesAdded} added &middot;{' '}
					{scanResult.filesUpdated} updated &middot; {scanResult.filesRemoved} removed
				</div>
			)}

			{showBrowse && (
				<FolderBrowser
					isOpen={isBrowseOpen}
					onClose={() => setIsBrowseOpen(false)}
					onSelect={onPathChange}
					initialPath={path || undefined}
				/>
			)}
		</div>
	);
}

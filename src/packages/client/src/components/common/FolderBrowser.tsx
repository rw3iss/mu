import { useState, useEffect, useCallback } from 'preact/hooks';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { sourcesService } from '@/services/sources.service';
import type { BrowseResult } from '@/services/sources.service';
import styles from './FolderBrowser.module.scss';

interface FolderBrowserProps {
	isOpen: boolean;
	onClose: () => void;
	onSelect: (path: string) => void;
	initialPath?: string;
}

export function FolderBrowser({ isOpen, onClose, onSelect, initialPath }: FolderBrowserProps) {
	const [data, setData] = useState<BrowseResult | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');

	const loadPath = useCallback(async (path?: string) => {
		setIsLoading(true);
		setError('');
		try {
			const result = await sourcesService.browse(path);
			setData(result);
		} catch (err: any) {
			setError(err?.body?.message || err?.message || 'Failed to browse directory');
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (isOpen) {
			loadPath(initialPath || undefined);
		}
	}, [isOpen, initialPath, loadPath]);

	const handleSelect = useCallback(() => {
		if (data?.currentPath) {
			onSelect(data.currentPath);
			onClose();
		}
	}, [data, onSelect, onClose]);

	const pathSegments = data?.currentPath ? data.currentPath.split('/').filter(Boolean) : [];

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Browse Folders" size="md">
			<div class={styles.browser}>
				{/* Breadcrumb */}
				{data && (
					<div class={styles.breadcrumb}>
						<button class={styles.breadcrumbSegment} onClick={() => loadPath('/')}>
							/
						</button>
						{pathSegments.map((segment, i) => {
							const segmentPath = `/${pathSegments.slice(0, i + 1).join('/')}`;
							return (
								<span key={segmentPath}>
									<span class={styles.breadcrumbSeparator}>/</span>
									<button
										class={styles.breadcrumbSegment}
										onClick={() => loadPath(segmentPath)}
									>
										{segment}
									</button>
								</span>
							);
						})}
					</div>
				)}

				{/* Directory listing */}
				<div class={styles.listing}>
					{isLoading && (
						<div class={styles.loading}>
							<Spinner size="sm" />
						</div>
					)}

					{error && <div class={styles.error}>{error}</div>}

					{!isLoading && !error && data && (
						<>
							{data.parentPath && (
								<button
									class={styles.dirEntry}
									onClick={() => loadPath(data.parentPath!)}
								>
									<span class={styles.dirIcon}>..</span>
									<span class={styles.dirName}>Parent directory</span>
								</button>
							)}
							{data.directories.length === 0 && !data.parentPath && (
								<div class={styles.empty}>No subdirectories</div>
							)}
							{data.directories.map((dir) => (
								<button
									key={dir.path}
									class={styles.dirEntry}
									onClick={() => loadPath(dir.path)}
								>
									<span class={styles.dirIcon}>&#128193;</span>
									<span class={styles.dirName}>{dir.name}</span>
								</button>
							))}
						</>
					)}
				</div>

				{/* Current path + select */}
				<div class={styles.footer}>
					<span class={styles.currentPath}>{data?.currentPath || '/'}</span>
					<Button variant="primary" size="sm" onClick={handleSelect} disabled={!data}>
						Select This Folder
					</Button>
				</div>
			</div>
		</Modal>
	);
}

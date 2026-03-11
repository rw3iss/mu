import { useEffect } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { MovieGrid } from '@/components/movie/MovieGrid';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import { api } from '@/services/api';
import {
	clearHistoryCache,
	fetchHistory,
	historyEntries,
	historyLoading,
} from '@/state/history.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './History.module.scss';

interface HistoryProps {
	path?: string;
}

export function History(_props: HistoryProps) {
	// Always fetch fresh data from the server when the page mounts.
	// This replaces the cache with the authoritative server state,
	// while in-session updates via pushToHistory keep it current between visits.
	useEffect(() => {
		fetchHistory();
	}, []);

	const movies = historyEntries.value ?? [];
	const isLoading = historyLoading.value && movies.length === 0;

	async function handleClearHistory() {
		try {
			await api.delete('/history');
			clearHistoryCache();
			notifySuccess('Watch history cleared');
		} catch {
			notifyError('Failed to clear history');
		}
	}

	return (
		<div class={styles.history}>
			<div class={styles.header}>
				<div>
					<h1 class={styles.title}>Watch History</h1>
					{movies.length > 0 && (
						<span class={styles.count}>
							{movies.length} {movies.length === 1 ? 'movie' : 'movies'}
						</span>
					)}
				</div>
				{movies.length > 0 && (
					<Button variant="ghost" size="sm" onClick={handleClearHistory}>
						Clear History
					</Button>
				)}
			</div>

			<MovieGrid
				movies={movies}
				isLoading={isLoading}
				emptyMessage="No watch history yet. Start watching movies to see them here."
			/>

			<PluginSlot name={UI.HISTORY_BOTTOM} context={{}} />
		</div>
	);
}

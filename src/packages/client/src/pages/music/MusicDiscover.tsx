import { route } from 'preact-router';
import { EmptyState } from '@/components/common/EmptyState';
import styles from './MusicHome.module.scss';

interface MusicDiscoverProps {
	path?: string;
}

/** Placeholder until music discovery ships (a later phase of the music plan). */
export function MusicDiscover(_props: MusicDiscoverProps) {
	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<h1 class={styles.title}>Discover</h1>
			</header>
			<div class={styles.comingSoon}>
				<EmptyState
					variant="dashed"
					icon="music"
					title="Music Discover is coming soon"
					message="Personal recommendations, similar artists and new releases from your listening history will appear here."
					actionLabel="Browse your library"
					onAction={() => route('/music/library')}
				/>
			</div>
		</div>
	);
}

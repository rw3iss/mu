import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Spinner } from '@/components/common/Spinner';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { globalMovie, globalMovieId, playerMode, playMovie } from '@/state/globalPlayer.state';
import { notifyError } from '@/state/notifications.state';
import { currentSession } from '@/state/player.state';
import { sharedVideoEngine } from '@/state/videoEngineRef';
import styles from './Player.module.scss';

interface PlayerProps {
	path?: string;
	id?: string;
}

export function Player({ id }: PlayerProps) {
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!id) return;

		// Ensure full mode
		playerMode.value = 'full';

		// If globalPlayer is already handling this movie, nothing else to do —
		// the session is either ready or GlobalPlayer's effect will start it.
		if (globalMovieId.value === id) return;

		// New movie — kick off via globalPlayer
		playMovie(id).catch((err) => {
			console.error('Failed to start stream:', err);
			setError('Failed to start playback');
			notifyError('Failed to start playback');
		});
	}, [id]);

	// Loading: no session yet and no error (reading .value makes this reactive)
	if (!currentSession.value && !error) {
		return (
			<div class={styles.player} data-player-container>
				<div class={styles.loading}>
					<Spinner size="lg" color="#ffffff" />
					<span>Preparing stream...</span>
				</div>
			</div>
		);
	}

	if (error || !currentSession.value) {
		return (
			<div class={styles.player} data-player-container>
				<div class={styles.error}>
					<p>{error || 'Something went wrong'}</p>
					<button
						class={styles.backButton}
						onClick={() => (id ? route(`/movie/${id}`) : history.back())}
					>
						Go Back
					</button>
				</div>
			</div>
		);
	}

	const movie = globalMovie.value;
	const engine = sharedVideoEngine.value;

	return (
		<div class={styles.player} data-player-container>
			<VideoPlayer
				streamUrl={currentSession.value.streamUrl}
				directPlay={currentSession.value.directPlay}
				startPosition={currentSession.value.startPosition}
				movie={movie}
				externalEngine={engine}
			/>
		</div>
	);
}

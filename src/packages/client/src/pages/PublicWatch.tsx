import { useEffect, useState } from 'preact/hooks';
import { useSeo } from '@/hooks/useSeo';
import { shareLinksService } from '@/services/share-links.service';
import { forceStartPosition, playerMode, playMovie } from '@/state/globalPlayer.state';
import { setShareToken, shareToken } from '@/state/share.state';

interface PublicWatchProps {
	token?: string;
}

/**
 * Public route `/watch/:token` — anonymous movie playback via a share link.
 *
 * Flow:
 * 1. Extract token from URL, install into share state BEFORE any API call.
 * 2. Verify token with the server.
 * 3. On success, invoke playMovie() and force full mode.
 * 4. On failure, render an error page.
 *
 * Renders no player UI of its own — the GlobalPlayer (mounted at app root)
 * handles all playback. This page is just the bootstrap.
 */
export function PublicWatch({ token }: PublicWatchProps) {
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	// Server-side meta injection already supplies the real movie title /
	// poster for crawlers + share previews; this just makes the in-app
	// tab title sane while playback boots.
	useSeo({
		title: 'Watch',
		description: 'Playing a movie shared from a private Mu library.',
		type: 'video.other',
		robots: 'noindex,follow',
	});

	useEffect(() => {
		if (!token) {
			setError('Missing share token');
			setLoading(false);
			return;
		}

		// Install token eagerly so verify() and subsequent stream calls use it.
		// If the token turns out to be invalid, we clear it on error.
		setShareToken(token, '');

		shareLinksService
			.verify(token)
			.then((result) => {
				if (!result.valid || !result.movieId) {
					setError('This share link is invalid or has expired.');
					setLoading(false);
					return;
				}
				// Re-store with the real movieId
				setShareToken(token, result.movieId);
				// `?t=<seconds>` deep-link → seek there and autoplay.
				const t = new URLSearchParams(window.location.search).get('t');
				const seconds = t != null ? Math.max(0, Number.parseFloat(t) || 0) : 0;
				if (seconds > 0) forceStartPosition.value = seconds;
				// Force full mode (share viewers cannot minimize/split)
				playerMode.value = 'full';
				playMovie(result.movieId).catch((err) => {
					setError(err?.message || 'Failed to start playback');
				});
				setLoading(false);
			})
			.catch(() => {
				setError('This share link is invalid or has expired.');
				setLoading(false);
			});
	}, [token]);

	if (loading) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100vh',
					background: '#000',
					color: '#fff',
				}}
			>
				<div class="skeleton" style={{ width: 48, height: 48, borderRadius: '50%' }} />
			</div>
		);
	}

	if (error) {
		return (
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100vh',
					background: '#000',
					color: '#fff',
					fontFamily: 'system-ui, sans-serif',
					textAlign: 'center',
					padding: '0 24px',
				}}
			>
				<h1 style={{ fontSize: 24, marginBottom: 12 }}>Unable to play this movie</h1>
				<p style={{ opacity: 0.75, maxWidth: 520 }}>{error}</p>
			</div>
		);
	}

	// Player is rendered by GlobalPlayer at the app root.
	// Keep a reference to shareToken.value so the signal is subscribed to for re-renders.
	void shareToken.value;
	return null;
}

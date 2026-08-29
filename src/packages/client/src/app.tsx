import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Router, route } from 'preact-router';
import { Toast } from '@/components/common/Toast';
import { AppShell } from '@/components/layout/AppShell';
import { Changelog } from '@/pages/Changelog';
import { Dashboard } from '@/pages/Dashboard';
import { Discover } from '@/pages/Discover';
import { Favorites } from '@/pages/Favorites';
import { Feedback } from '@/pages/Feedback';
import { GroupDetail } from '@/pages/GroupDetail';
import { History } from '@/pages/History';
import { JobDetails } from '@/pages/JobDetails';
import { Library } from '@/pages/Library';
import { Login } from '@/pages/Login';
import { MembersPage } from '@/pages/Members/MembersPage';
import { MovieDetail } from '@/pages/MovieDetail';
import { NotFound } from '@/pages/NotFound';
import { PersonDetail } from '@/pages/PersonDetail';
// Player is now handled entirely by GlobalPlayer (no dedicated route)
import { PlaylistDetail } from '@/pages/PlaylistDetail';
import { Playlists } from '@/pages/Playlists';
import { ProfilePage } from '@/pages/Profile/ProfilePage';
import { PublicWatch } from '@/pages/PublicWatch';
import { Register } from '@/pages/Register';
import { Settings } from '@/pages/Settings';
import { Setup } from '@/pages/Setup';
import { Watchlist } from '@/pages/Watchlist';
import {
	checkAuth,
	isAuthenticated,
	isLoading,
	isSetupComplete,
	localBypass,
} from '@/state/auth.state';
import { initTheme } from '@/state/theme.state';
import '@/state/accentColor.state';
import '@/state/appearance.state';
import { audioEngine } from '@/audio/audio-engine';
import { UploadProgressToast } from '@/components/library/UploadProgressToast';
import { GlobalPlayer } from '@/components/player/GlobalPlayer';
import { SessionModals } from '@/components/player/session/SessionModals';
import { useScanEvents } from '@/hooks/useScanEvents';
import { pluginClientManager } from '@/plugins/plugin-client-manager';
import { sharedSessionService } from '@/services/shared-session.service';
import { socketManager } from '@/services/socket-manager';
import { wsService } from '@/services/websocket.service';
import { ensureFavoritesLoaded } from '@/state/favorites.state';
import { initGlobalPlayer } from '@/state/globalPlayer.state';
import { initMediaSession } from '@/state/media-session';
import { initNotifications } from '@/state/notifications-feed.state';
import { fetchPlaybackSettings } from '@/state/playbackSettings.state';
import { initProcessingState } from '@/state/processing.state';
import { loadSystemConfig } from '@/state/system.state';
import { fetchThemes } from '@/state/themes.state';
import { installUserGestureListener } from '@/state/user-gesture.state';
import { fetchWatchPositions } from '@/state/watchPositions.state';
import { initConsoleDebug } from '@/utils/console-debug';
import { initDebugPanel } from '@/utils/debug-panel';

export const currentPath = signal(typeof window !== 'undefined' ? window.location.pathname : '/');
/**
 * Full URL (pathname + querystring), updated on every router change.
 * Pages that need to react to query-only changes (e.g. /library
 * picking up a new ?q= when the header search clears) depend on
 * this instead of `currentPath`, which only ticks on pathname swaps.
 */
export const currentUrl = signal(
	typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/',
);

function Redirect({
	to,
	path: _path,
	preserveQuery,
}: {
	to: string;
	path: string;
	preserveQuery?: boolean;
}) {
	useEffect(() => {
		const target =
			preserveQuery && window.location.search ? `${to}${window.location.search}` : to;
		route(target, true);
	}, []);
	return null;
}

function enforceAuth(url: string): boolean {
	if (isLoading.value) return false;

	// Public share-watch route bypasses all auth enforcement.
	if (url.startsWith('/watch/')) return false;

	if (!isSetupComplete.value && url !== '/setup') {
		route('/setup', true);
		return true;
	}

	// Skip auth checks when local bypass is active
	if (localBypass.value) return false;

	if (!isAuthenticated.value && !['/login', '/setup', '/register'].includes(url)) {
		route('/login', true);
		return true;
	}

	return false;
}

/** Default tab title per route. Pages using useSeo (movie/person/discover/
 *  watch) overwrite this right after mount with richer titles. The global
 *  player intentionally does NOT touch the title — the tab always reflects
 *  the page being viewed, not whatever is playing. */
function titleForPath(path: string): string {
	const seg = (path.split('/')[1] ?? '').toLowerCase();
	const names: Record<string, string> = {
		'': 'Dashboard',
		library: 'Library',
		discover: 'Discover',
		playlists: 'Playlists',
		watchlist: 'Watchlist',
		favorites: 'Favorites',
		history: 'History',
		members: 'Members',
		profile: 'Profile',
		settings: 'Settings',
		movie: 'Movie',
		group: 'Group',
		person: 'Person',
		admin: 'Admin',
		feedback: 'Feedback',
		login: 'Login',
		setup: 'Setup',
		register: 'Register',
		watch: 'Watch',
	};
	const name = names[seg];
	return name ? `${name} — Mu` : 'Mu';
}

function handleRouteChange(e: { url: string }) {
	currentUrl.value = e.url;
	const url = e.url.split('?')[0] ?? e.url;
	currentPath.value = url;
	document.title = titleForPath(url);

	if (enforceAuth(url)) return;
}

export function App() {
	useEffect(() => {
		installUserGestureListener();
		initTheme();
		checkAuth();
		wsService.connect();
		socketManager.start();
		initGlobalPlayer();
		// Lock-screen / notification media controls (Android + iOS).
		initMediaSession();
		initProcessingState();
		initConsoleDebug();
		initDebugPanel();
		fetchThemes();

		// Ensure AudioContext is created on first user interaction (Chrome requirement)
		const unlockAudio = () => {
			audioEngine.ensureContext();
			document.removeEventListener('click', unlockAudio);
			document.removeEventListener('touchstart', unlockAudio);
			document.removeEventListener('keydown', unlockAudio);
		};
		document.addEventListener('click', unlockAudio);
		document.addEventListener('touchstart', unlockAudio);
		document.addEventListener('keydown', unlockAudio);

		// Refresh watch positions when the tab regains focus so a movie
		// watched on another device / tab shows the right resume bar.
		const onFocus = () => {
			if (isAuthenticated.value || localBypass.value) {
				void fetchWatchPositions(true);
			}
		};
		window.addEventListener('focus', onFocus);

		return () => {
			wsService.disconnect();
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('click', unlockAudio);
			document.removeEventListener('touchstart', unlockAudio);
			document.removeEventListener('keydown', unlockAudio);
		};
	}, []);

	// Enforce auth redirect on initial load once checkAuth() completes
	useEffect(() => {
		if (!isLoading.value) {
			enforceAuth(currentPath.value);
		}
	}, [isLoading.value]);

	// Initialize client-side plugins once auth is resolved
	useEffect(() => {
		if (!isLoading.value && (isAuthenticated.value || localBypass.value)) {
			pluginClientManager.initialize();
			void ensureFavoritesLoaded();
			void fetchWatchPositions();
			void fetchPlaybackSettings();
			void loadSystemConfig();
			initNotifications();
			sharedSessionService.initSharedSessions();
			void sharedSessionService.hydrate();
		}
	}, [isLoading.value, isAuthenticated.value]);

	useScanEvents();

	if (isLoading.value) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100vh',
				}}
			>
				<div
					class="skeleton"
					style={{ width: '48px', height: '48px', borderRadius: '50%' }}
				/>
			</div>
		);
	}

	const path = currentPath.value;
	const isAuthRoute = path === '/login' || path === '/setup' || path === '/register';
	const isPublicWatch = path.startsWith('/watch/');

	return (
		<div>
			<Toast />
			{!isAuthRoute && <UploadProgressToast />}
			{!isAuthRoute && <GlobalPlayer />}
			{!isAuthRoute && <SessionModals />}
			{isPublicWatch ? (
				<Router onChange={handleRouteChange}>
					<PublicWatch path="/watch/:token" />
					<NotFound default />
				</Router>
			) : isAuthRoute ? (
				<Router onChange={handleRouteChange}>
					<Login path="/login" />
					<Setup path="/setup" />
					<Register path="/register" />
					<NotFound default />
				</Router>
			) : (
				<AppShell>
					<Router onChange={handleRouteChange}>
						<Dashboard path="/" />
						<Library path="/library" />
						<MovieDetail path="/movie/:id" />
						<GroupDetail path="/group/:id" />
						<Playlists path="/playlists" />
						<PlaylistDetail path="/playlists/:id" />
						<Watchlist path="/watchlist" />
						<Favorites path="/favorites" />
						<History path="/history" />
						<MembersPage path="/members" />
						<ProfilePage path="/profile" />
						<ProfilePage path="/profile/:username" />
						<Discover path="/discover" />
						<Redirect path="/search" to="/library" preserveQuery />
						<Settings path="/settings/:tab?" />
						<Feedback path="/feedback" />
						<Changelog path="/changelog" />
						<Redirect path="/plugins" to="/settings/plugins" />
						<Redirect path="/admin" to="/settings/admin" />
						{/* Job list now lives in Settings → Jobs; preserve the
						    old /admin/jobs URL by redirecting there. Detail
						    page stays at /admin/jobs/:id. */}
						<Redirect path="/admin/jobs" to="/settings/jobs" />
						<JobDetails path="/admin/jobs/:id" />
						<PersonDetail path="/person/:id" />
						<Login path="/login" />
						<Setup path="/setup" />
						<NotFound default />
					</Router>
				</AppShell>
			)}
		</div>
	);
}

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Router, route } from 'preact-router';
import { Toast } from '@/components/common/Toast';
import { AppShell } from '@/components/layout/AppShell';
import { Changelog } from '@/pages/Changelog';
import { Dashboard } from '@/pages/Dashboard';
import { Discover } from '@/pages/Discover';
import { GroupDetail } from '@/pages/GroupDetail';
import { History } from '@/pages/History';
import { JobDetails } from '@/pages/JobDetails';
import { JobList } from '@/pages/JobList';
import { Library } from '@/pages/Library';
import { Login } from '@/pages/Login';
import { MovieDetail } from '@/pages/MovieDetail';
import { NotFound } from '@/pages/NotFound';
import { PersonDetail } from '@/pages/PersonDetail';
// Player is now handled entirely by GlobalPlayer (no dedicated route)
import { PlaylistDetail } from '@/pages/PlaylistDetail';
import { Playlists } from '@/pages/Playlists';
import { PublicWatch } from '@/pages/PublicWatch';
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
import { GlobalPlayer } from '@/components/player/GlobalPlayer';
import { useScanEvents } from '@/hooks/useScanEvents';
import { pluginClientManager } from '@/plugins/plugin-client-manager';
import { wsService } from '@/services/websocket.service';
import { initGlobalPlayer } from '@/state/globalPlayer.state';
import { initProcessingState } from '@/state/processing.state';
import { fetchThemes } from '@/state/themes.state';
import { initConsoleDebug } from '@/utils/console-debug';

export const currentPath = signal(typeof window !== 'undefined' ? window.location.pathname : '/');

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

	if (!isAuthenticated.value && !['/login', '/setup'].includes(url)) {
		route('/login', true);
		return true;
	}

	return false;
}

function handleRouteChange(e: { url: string }) {
	const url = e.url.split('?')[0] ?? e.url;
	currentPath.value = url;

	if (enforceAuth(url)) return;
}

export function App() {
	useEffect(() => {
		initTheme();
		checkAuth();
		wsService.connect();
		initGlobalPlayer();
		initProcessingState();
		initConsoleDebug();
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

		return () => {
			wsService.disconnect();
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
	const isAuthRoute = path === '/login' || path === '/setup';
	const isPublicWatch = path.startsWith('/watch/');

	return (
		<div>
			<Toast />
			{!isAuthRoute && <GlobalPlayer />}
			{isPublicWatch ? (
				<Router onChange={handleRouteChange}>
					<PublicWatch path="/watch/:token" />
					<NotFound default />
				</Router>
			) : isAuthRoute ? (
				<Router onChange={handleRouteChange}>
					<Login path="/login" />
					<Setup path="/setup" />
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
						<History path="/history" />
						<Discover path="/discover" />
						<Redirect path="/search" to="/library" preserveQuery />
						<Settings path="/settings/:tab?" />
						<Changelog path="/changelog" />
						<Redirect path="/plugins" to="/settings/plugins" />
						<Redirect path="/admin" to="/settings/admin" />
						<JobList path="/admin/jobs" />
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

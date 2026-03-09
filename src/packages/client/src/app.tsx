import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Router, route } from 'preact-router';
import { AppShell } from '@/components/layout/AppShell';
import { Toast } from '@/components/common/Toast';
import { Dashboard } from '@/pages/Dashboard';
import { Library } from '@/pages/Library';
import { MovieDetail } from '@/pages/MovieDetail';
import { Player } from '@/pages/Player';
import { Playlists } from '@/pages/Playlists';
import { PlaylistDetail } from '@/pages/PlaylistDetail';
import { Watchlist } from '@/pages/Watchlist';
import { History } from '@/pages/History';
import { Discover } from '@/pages/Discover';
import { Search } from '@/pages/Search';
import { Settings } from '@/pages/Settings';
import { Changelog } from '@/pages/Changelog';
import { PersonDetail } from '@/pages/PersonDetail';
import { Login } from '@/pages/Login';
import { Setup } from '@/pages/Setup';
import { NotFound } from '@/pages/NotFound';
import {
	isAuthenticated,
	isSetupComplete,
	isLoading,
	localBypass,
	checkAuth,
} from '@/state/auth.state';
import { initTheme } from '@/state/theme.state';
import '@/state/accentColor.state';
import { wsService } from '@/services/websocket.service';
import { useScanEvents } from '@/hooks/useScanEvents';
import { GlobalPlayer } from '@/components/player/GlobalPlayer';
import { initGlobalPlayer, playerMode, isPlayerActive } from '@/state/globalPlayer.state';
import { pluginClientManager } from '@/plugins/plugin-client-manager';

export const currentPath = signal(typeof window !== 'undefined' ? window.location.pathname : '/');

function Redirect({ to, path: _path }: { to: string; path: string }) {
	useEffect(() => {
		route(to, true);
	}, []);
	return null;
}

function enforceAuth(url: string): boolean {
	if (isLoading.value) return false;

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

	// Auto-minimize player when navigating away from the player page
	// (e.g. browser back button). closePlayer/minimizePlayer set the mode
	// before routing, so this only catches external navigation (popstate).
	if (!url.startsWith('/player/') && playerMode.value === 'full' && isPlayerActive.value) {
		playerMode.value = 'mini';
	}
}

export function App() {
	useEffect(() => {
		initTheme();
		checkAuth();
		wsService.connect();
		initGlobalPlayer();
		return () => wsService.disconnect();
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
	const isPlayerRoute = path.startsWith('/player/');
	const isAuthRoute = path === '/login' || path === '/setup';

	return (
		<div>
			<Toast />
			<GlobalPlayer />
			{isAuthRoute || isPlayerRoute ? (
				<Router onChange={handleRouteChange}>
					<Login path="/login" />
					<Setup path="/setup" />
					<Player path="/player/:id" />
					<NotFound default />
				</Router>
			) : (
				<AppShell>
					<Router onChange={handleRouteChange}>
						<Dashboard path="/" />
						<Library path="/library" />
						<MovieDetail path="/movie/:id" />
						<Player path="/player/:id" />
						<Playlists path="/playlists" />
						<PlaylistDetail path="/playlists/:id" />
						<Watchlist path="/watchlist" />
						<History path="/history" />
						<Discover path="/discover" />
						<Search path="/search" />
						<Settings path="/settings/:tab?" />
						<Changelog path="/changelog" />
						<Redirect path="/plugins" to="/settings/plugins" />
						<Redirect path="/admin" to="/settings/admin" />
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

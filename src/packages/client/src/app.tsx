import { h } from 'preact';
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
import { Plugins } from '@/pages/Plugins';
import { AdminDashboard } from '@/pages/AdminDashboard';
import { PersonDetail } from '@/pages/PersonDetail';
import { Login } from '@/pages/Login';
import { Setup } from '@/pages/Setup';
import { NotFound } from '@/pages/NotFound';
import { isAuthenticated, isSetupComplete, isLoading, checkAuth } from '@/state/auth.state';
import { initTheme } from '@/state/theme.state';
import { wsService } from '@/services/websocket.service';
import { useScanEvents } from '@/hooks/useScanEvents';

export const currentPath = signal(typeof window !== 'undefined' ? window.location.pathname : '/');

function handleRouteChange(e: { url: string }) {
  const url = e.url.split('?')[0] ?? e.url;
  currentPath.value = url;

  if (isLoading.value) return;

  if (!isSetupComplete.value && url !== '/setup') {
    route('/setup', true);
    return;
  }

  if (!isAuthenticated.value && !['/login', '/setup'].includes(url)) {
    route('/login', true);
    return;
  }
}

export function App() {
  useEffect(() => {
    initTheme();
    checkAuth();
    wsService.connect();
    return () => wsService.disconnect();
  }, []);

  useScanEvents();

  if (isLoading.value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div class="skeleton" style={{ width: '48px', height: '48px', borderRadius: '50%' }} />
      </div>
    );
  }

  const path = currentPath.value;
  const isPlayerRoute = path.startsWith('/player/');
  const isAuthRoute = path === '/login' || path === '/setup';

  return (
    <div>
      <Toast />
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
            <Settings path="/settings" />
            <Plugins path="/plugins" />
            <AdminDashboard path="/admin" />
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

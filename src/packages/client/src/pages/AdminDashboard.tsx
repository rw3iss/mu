import { h } from 'preact';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { streamService } from '@/services/stream.service';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import type { ActiveSession } from '@/services/stream.service';
import styles from './AdminDashboard.module.scss';

interface AdminDashboardProps {
  path?: string;
}

interface SystemInfo {
  version: string;
  uptime: number;
  totalMovies: number;
  totalUsers: number;
  diskUsage: { used: number; total: number };
}

export function AdminDashboard(_props: AdminDashboardProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);
  const [endingAll, setEndingAll] = useState(false);
  const [generatingThumbnails, setGeneratingThumbnails] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    try {
      const [info, sessions] = await Promise.allSettled([
        api.get<SystemInfo>('/admin/system'),
        streamService.getActiveSessions(),
      ]);

      if (info.status === 'fulfilled') setSystemInfo(info.value);
      if (sessions.status === 'fulfilled') setActiveSessions(sessions.value);
    } catch (error) {
      console.error('Failed to load admin data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleScanLibrary = useCallback(async () => {
    try {
      await api.post('/sources/scan');
      notifySuccess('Library scan started');
    } catch {
      notifyError('Failed to start library scan');
    }
  }, []);

  const handleRefreshMetadata = useCallback(async () => {
    try {
      await api.post('/movies/refresh-all');
      notifySuccess('Metadata refresh started for all movies');
    } catch {
      notifyError('Failed to start metadata refresh');
    }
  }, []);

  const handleGenerateThumbnails = useCallback(async () => {
    setGeneratingThumbnails(true);
    try {
      const result = await streamService.generateMissingThumbnails();
      notifySuccess(`Thumbnail generation started for ${result.movieCount} movies`);
    } catch {
      notifyError('Failed to start thumbnail generation');
    } finally {
      setGeneratingThumbnails(false);
    }
  }, []);

  const handleEndSession = useCallback(async (sessionId: string) => {
    setEndingSessionId(sessionId);
    try {
      await streamService.endSession(sessionId);
      setActiveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      notifySuccess('Session ended');
    } catch {
      notifyError('Failed to end session');
    } finally {
      setEndingSessionId(null);
    }
  }, []);

  const handleEndAllSessions = useCallback(async () => {
    setEndingAll(true);
    try {
      const result = await streamService.endAllSessions();
      setActiveSessions([]);
      notifySuccess(`Ended ${result.endedCount} session(s)`);
    } catch {
      notifyError('Failed to end sessions');
    } finally {
      setEndingAll(false);
    }
  }, []);

  if (isLoading) {
    return (
      <div class={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  return (
    <div class={styles.admin}>
      <h1 class={styles.title}>Admin Dashboard</h1>

      {/* Stats Grid */}
      {systemInfo && (
        <div class={styles.statsGrid}>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>Total Movies</span>
            <span class={styles.statValue}>{systemInfo.totalMovies}</span>
          </div>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>Total Users</span>
            <span class={styles.statValue}>{systemInfo.totalUsers}</span>
          </div>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>Active Streams</span>
            <span class={styles.statValue}>{activeSessions.length}</span>
          </div>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>Uptime</span>
            <span class={styles.statValue}>{formatUptime(systemInfo.uptime)}</span>
          </div>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>Disk Usage</span>
            <span class={styles.statValue}>
              {formatBytes(systemInfo.diskUsage.used)} / {formatBytes(systemInfo.diskUsage.total)}
            </span>
          </div>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>Version</span>
            <span class={styles.statValue}>{systemInfo.version}</span>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Quick Actions</h2>
        <div class={styles.actions}>
          <Button variant="secondary" onClick={handleScanLibrary}>
            Scan Library
          </Button>
          <Button variant="secondary" onClick={handleRefreshMetadata}>
            Refresh All Metadata
          </Button>
          <Button
            variant="secondary"
            onClick={handleGenerateThumbnails}
            loading={generatingThumbnails}
          >
            Fetch Missing Thumbnails
          </Button>
        </div>
      </section>

      {/* Active Sessions */}
      <section class={styles.section}>
        <div class={styles.sectionHeader}>
          <h2 class={styles.sectionTitle}>Active Sessions</h2>
          {activeSessions.length > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleEndAllSessions}
              loading={endingAll}
            >
              End All Sessions
            </Button>
          )}
        </div>
        {activeSessions.length > 0 && (
          <p class={styles.endAllNote}>
            This will end all active sessions except your current one.
          </p>
        )}
        {activeSessions.length === 0 ? (
          <p class={styles.emptyText}>No active streams</p>
        ) : (
          <div class={styles.sessionList}>
            {activeSessions.map((session) => (
              <div key={session.sessionId} class={styles.sessionItem}>
                <div class={styles.sessionInfo}>
                  <span class={styles.sessionUser}>{session.username || 'Unknown'}</span>
                  <span class={styles.sessionMovie}>{session.movieTitle || 'Unknown'}</span>
                </div>
                <span class={styles.sessionTime}>
                  Started {new Date(session.startedAt).toLocaleTimeString()}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleEndSession(session.sessionId)}
                  loading={endingSessionId === session.sessionId}
                >
                  End
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

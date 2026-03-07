import { useEffect } from 'preact/hooks';
import { wsService } from '@/services/websocket.service';
import { notifySuccess, notifyError, notifyInfo } from '@/state/notifications.state';

interface ScanStartedData {
  sourceId: string;
  logId: string;
}

interface ScanCompletedData {
  sourceId: string;
  logId: string;
  filesFound: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
}

interface ScanErrorData {
  sourceId: string;
  logId: string;
  error: string;
}

function shouldNotify(): boolean {
  const stored = localStorage.getItem('mu_notify_scan');
  return stored !== 'false';
}

export function useScanEvents(): void {
  useEffect(() => {
    function handleScanStarted(_data: unknown) {
      if (!shouldNotify()) return;
      notifyInfo('Library scan started...');
    }

    function handleScanCompleted(data: unknown) {
      if (!shouldNotify()) return;
      const d = data as ScanCompletedData;
      const parts: string[] = [];
      if (d.filesAdded > 0) parts.push(`${d.filesAdded} added`);
      if (d.filesUpdated > 0) parts.push(`${d.filesUpdated} updated`);
      if (d.filesRemoved > 0) parts.push(`${d.filesRemoved} removed`);
      const summary = parts.length > 0 ? parts.join(', ') : 'no changes';
      notifySuccess(`Scan complete: ${d.filesFound} files found (${summary})`);
    }

    function handleScanError(data: unknown) {
      if (!shouldNotify()) return;
      const d = data as ScanErrorData;
      notifyError(`Scan failed: ${d.error}`);
    }

    wsService.on('scan:started', handleScanStarted);
    wsService.on('scan:completed', handleScanCompleted);
    wsService.on('scan:error', handleScanError);

    // Subscribe to scan channel so the gateway sends us these events
    wsService.subscribe('scan');

    return () => {
      wsService.off('scan:started', handleScanStarted);
      wsService.off('scan:completed', handleScanCompleted);
      wsService.off('scan:error', handleScanError);
      wsService.unsubscribe('scan');
    };
  }, []);
}

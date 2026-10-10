import type { TrackSummary } from '@mu/shared';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import type { OfflineGroupKind } from '@/services/music-offline-index';
import {
	cancelDownload,
	downloadJobs,
	downloadTracks,
	groupKey,
	groupStatus,
	offlineAllowed,
	offlineManifest,
	removeGroup,
	setKeep,
} from '@/state/musicOffline.state';

interface Props {
	kind: OfflineGroupKind;
	id: string;
	title: string;
	tracks: TrackSummary[];
	size?: 'sm' | 'md';
}

/**
 * Album / playlist header control: Download → progress (click to stop) →
 * Downloaded (click to remove) + a "Keep" pin that exempts it from eviction.
 * Hidden when the admin doesn't allow downloads for this user.
 */
export function OfflineDownloadButton({ kind, id, title, tracks, size = 'sm' }: Props) {
	if (!offlineAllowed.value || tracks.length === 0) return null;
	const key = groupKey(kind, id);
	const status = groupStatus(key);
	const job = downloadJobs.value[key];
	const group = offlineManifest.value.groups[key];

	if (status === 'downloading' && job) {
		return (
			<Button
				variant="secondary"
				size={size}
				onClick={() => cancelDownload(key)}
				title="Stop downloading"
			>
				<Icon name="download" size={16} /> {job.done}/{job.total}
			</Button>
		);
	}
	if (status === 'downloaded' || status === 'partial') {
		return (
			<>
				<Button
					variant="secondary"
					size={size}
					onClick={() =>
						status === 'partial'
							? downloadTracks({ kind, id, title }, tracks)
							: void removeGroup(key)
					}
					title={status === 'partial' ? 'Download the missing tracks' : 'Remove download'}
				>
					<Icon name={status === 'partial' ? 'download' : 'check'} size={16} />{' '}
					{status === 'partial' ? 'Resume' : 'Downloaded'}
				</Button>
				<Button
					variant={group?.keep ? 'primary' : 'ghost'}
					size={size}
					onClick={() => setKeep(key, !group?.keep)}
					title="Keep: never remove this to free space"
					aria-label={
						group?.keep ? 'Kept offline (click to allow removal)' : 'Keep offline'
					}
				>
					Keep
				</Button>
			</>
		);
	}
	return (
		<Button
			variant="secondary"
			size={size}
			onClick={() => downloadTracks({ kind, id, title }, tracks)}
			title="Save for offline listening on this device"
		>
			<Icon name="download" size={16} /> Download
		</Button>
	);
}

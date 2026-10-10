import type { AlbumSummary, ArtistSummary, EntityRef, TrackSummary } from '@mu/shared';
import { playMedia } from '@/state/globalPlayer.state';
import { notifyError } from '@/state/notifications.state';
import { addToQueue, playNext, type QueueItem } from '@/state/queue.state';

/** `3:07` / `1:02:45`. Null/invalid → em dash. */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** `48 min` / `1 hr 12 min` — album/total lengths. */
export function formatTotalLength(seconds: number | null | undefined): string {
	if (!seconds || seconds <= 0) return '';
	const totalMin = Math.round(seconds / 60);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h === 0) return `${m} min`;
	return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** Human label for a MusicBrainz primary type. */
export function releaseTypeLabel(t: string | null | undefined): string {
	switch ((t ?? '').toLowerCase()) {
		case 'album':
			return 'Album';
		case 'ep':
			return 'EP';
		case 'single':
			return 'Single';
		case 'compilation':
			return 'Compilation';
		case 'broadcast':
			return 'Broadcast';
		case '':
			return 'Album';
		default:
			return t!.charAt(0).toUpperCase() + t!.slice(1);
	}
}

export function trackRef(id: string): EntityRef {
	return { type: 'track', id };
}

export function trackQueueItem(t: TrackSummary): QueueItem {
	return {
		ref: trackRef(t.id),
		title: t.title,
		subtitle: t.artistCredit ?? t.albumTitle ?? null,
		artUrl: t.artUrl,
		durationSeconds: t.durationSeconds,
	};
}

export function albumQueueItem(a: AlbumSummary): QueueItem {
	return {
		ref: { type: 'album', id: a.id },
		title: a.title,
		subtitle: a.artistCredit,
		artUrl: a.artUrl,
		durationSeconds: a.totalSeconds || null,
	};
}

export function artistQueueItem(a: ArtistSummary): QueueItem {
	return {
		ref: { type: 'artist', id: a.id },
		title: a.name,
		subtitle: 'Artist',
		artUrl: a.imageUrl,
		durationSeconds: null,
	};
}

/** Play any music entity, surfacing failures as a toast. */
export async function playMusic(ref: EntityRef): Promise<void> {
	try {
		await playMedia(ref);
	} catch (err) {
		notifyError((err as Error)?.message || 'Playback is not available');
	}
}

/**
 * Play a tracklist starting at `index`: plays that track now and lines up the
 * rest of the list (in order) at the front of the audio queue. Used for
 * "click a track row = play the album from here".
 */
export async function playTracksFrom(tracks: TrackSummary[], index: number): Promise<void> {
	const start = tracks[index];
	if (!start) return;
	const rest = tracks.slice(index + 1);
	// playNext inserts at the front, so walk backwards to keep album order.
	for (let i = rest.length - 1; i >= 0; i--) playNext(trackQueueItem(rest[i]!));
	await playMusic(trackRef(start.id));
}

/** Shuffle-play a list of tracks. */
export async function shuffleTracks(tracks: TrackSummary[]): Promise<void> {
	if (tracks.length === 0) return;
	const copy = [...tracks];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j]!, copy[i]!];
	}
	await playTracksFrom(copy, 0);
}

export function queueTracks(tracks: TrackSummary[]): void {
	for (const t of tracks) addToQueue(trackQueueItem(t));
}

/** Lower-case, strip punctuation / bracketed suffixes — for fuzzy title matches. */
export function normalizeTitle(s: string | null | undefined): string {
	return (s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s*[([].*?[)\]]\s*/g, ' ')
		.replace(/\bfeat\.?\b.*$/, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function formatFileSize(bytes: number | null | undefined): string {
	if (!bytes) return '—';
	const mb = bytes / (1024 * 1024);
	return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export function formatBitrate(bps: number | null | undefined): string {
	if (!bps) return '—';
	// Servers report either bps or kbps; anything under 10k is already kbps.
	const kbps = bps > 10_000 ? Math.round(bps / 1000) : Math.round(bps);
	return `${kbps} kbps`;
}

export function formatSampleRate(hz: number | null | undefined): string {
	if (!hz) return '—';
	return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}

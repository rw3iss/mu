import type { TrackSummary } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { musicService } from '@/services/music.service';
import { musicEnabled } from '@/state/features.state';
import { normalizeTitle } from '@/utils/music';
import { InlineLink } from './InlineLink';

/**
 * Per-session cache of soundtrack-title → local track lookups, so re-expanding
 * a soundtrack (or another movie sharing a song) doesn't search again.
 */
const cache = new Map<string, Promise<TrackSummary | null>>();

// Lookups run a few at a time — a 20-track soundtrack shouldn't fire 20
// concurrent searches the moment the section opens.
const MAX_CONCURRENT = 3;
let running = 0;
const waiting: (() => void)[] = [];

function schedule<T>(fn: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const start = () => {
			running++;
			fn()
				.then(resolve, reject)
				.finally(() => {
					running--;
					waiting.shift()?.();
				});
		};
		if (running < MAX_CONCURRENT) start();
		else waiting.push(start);
	});
}

function findLocal(title: string, artist: string | null): Promise<TrackSummary | null> {
	const nt = normalizeTitle(title);
	const na = normalizeTitle(artist);
	const key = `${nt}|${na}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const p = schedule(() => musicService.search(title))
		.then((r) => {
			const candidates = r.tracks.filter((t) => normalizeTitle(t.title) === nt);
			if (!na) return candidates[0] ?? null;
			const byArtist = candidates.find((t) => {
				const names = [t.artistCredit, ...t.artists.map((a) => a.name)].map(normalizeTitle);
				return names.some((n) => n && (n.includes(na) || na.includes(n)));
			});
			return byArtist ?? null;
		})
		.catch(() => null);
	cache.set(key, p);
	return p;
}

/**
 * On the movie Soundtrack list: when the song exists in the local music
 * library (normalised title + artist match), link to its track page. Renders
 * nothing when Music is disabled or there's no match. Mounted only while the
 * soundtrack section is expanded, so lookups are lazy.
 */
export function LocalTrackLink({
	title,
	artist,
	class: className,
}: {
	title: string;
	artist: string | null;
	class?: string;
}) {
	const [track, setTrack] = useState<TrackSummary | null>(null);
	const enabled = musicEnabled.value;

	useEffect(() => {
		if (!enabled || !title) return;
		let cancelled = false;
		findLocal(title, artist).then((t) => {
			if (!cancelled) setTrack(t);
		});
		return () => {
			cancelled = true;
		};
	}, [enabled, title, artist]);

	if (!enabled || !track) return null;
	return (
		<InlineLink
			href={`/track/${track.id}`}
			class={className}
			title={`In your library: ${track.title}${track.albumTitle ? ` — ${track.albumTitle}` : ''}`}
		>
			<Icon name="music" size={14} aria-label="Open in your music library" />
		</InlineLink>
	);
}

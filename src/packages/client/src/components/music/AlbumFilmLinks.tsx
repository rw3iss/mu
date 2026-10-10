import type { AlbumFilmLink } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { musicService } from '@/services/music.service';
import { InlineLink } from './InlineLink';

/**
 * "Soundtrack of <film>" links on the Album page — the reverse of the movie
 * page's Soundtrack → local track links. Renders nothing when no library film
 * matches (or the Movies feature has no such film).
 */
export function AlbumFilmLinks({ albumId, class: className }: { albumId: string; class?: string }) {
	const [films, setFilms] = useState<AlbumFilmLink[]>([]);

	useEffect(() => {
		let cancelled = false;
		setFilms([]);
		musicService
			.albumFilms(albumId)
			.then((f) => !cancelled && setFilms(f))
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [albumId]);

	if (!films.length) return null;
	return (
		<div class={className}>
			<Icon name="film" size={14} /> Soundtrack of{' '}
			{films.map((f, i) => (
				<span key={f.movieId}>
					{i > 0 && ', '}
					<InlineLink href={`/movie/${f.movieId}`}>
						{f.title}
						{f.year ? ` (${f.year})` : ''}
					</InlineLink>
				</span>
			))}
		</div>
	);
}

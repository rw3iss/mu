import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import type { Movie } from '@/state/library.state';

interface GroupBadgeProps {
	movie: Movie;
	class?: string;
}

/**
 * Tiny visual indicator that a movie is part of a group (TV season,
 * collection, …). Renders nothing if the movie isn't grouped. Clicking
 * navigates to the subgroup's parent group page.
 *
 * The badge swallows clicks so it doesn't fire the movie-card's own
 * click handler (which would start playback).
 */
export function GroupBadge({ movie, class: className }: GroupBadgeProps) {
	if (!movie.groupId) return null;
	return (
		<button
			class={className}
			type="button"
			title="Part of a group — click to open"
			aria-label="Open group"
			onClick={(e) => {
				e.stopPropagation();
				e.preventDefault();
				route(`/group/${movie.groupId}`);
			}}
		>
			<Icon name="layers" size={12} />
		</button>
	);
}

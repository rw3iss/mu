import { EntityPlaylists } from '@/components/common/EntityPlaylists';

interface MoviePlaylistsProps {
	movieId: string;
	remoteInfo?: { title: string; posterUrl?: string; serverId: string };
	/** Called when the member playlist count changes, so parent can show count in header. */
	onCountChange?: (count: number) => void;
	/** If true, hide the built-in section title (parent manages it). */
	hideTitle?: boolean;
}

/** Thin movie wrapper over the generic {@link EntityPlaylists}. */
export function MoviePlaylists({ movieId, ...rest }: MoviePlaylistsProps) {
	return <EntityPlaylists entity={{ type: 'movie', id: movieId }} {...rest} />;
}

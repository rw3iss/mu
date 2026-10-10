import { EntitySearchInput, type EntitySearchInputProps } from './EntitySearchInput.js';

/** Federated music search (artists / albums / tracks — library + MusicBrainz). */
export function MusicSearchInput(props: Omit<EntitySearchInputProps, 'type'>) {
	return (
		<EntitySearchInput
			type="music"
			placeholder={props.placeholder ?? 'Search artists, albums, tracks…'}
			{...props}
		/>
	);
}

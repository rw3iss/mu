import { EntitySearchInput, type EntitySearchInputProps } from './EntitySearchInput.js';

export function MovieSearchInput(props: Omit<EntitySearchInputProps, 'type'>) {
	return (
		<EntitySearchInput
			type="movie"
			placeholder={props.placeholder ?? 'Search movies…'}
			{...props}
		/>
	);
}

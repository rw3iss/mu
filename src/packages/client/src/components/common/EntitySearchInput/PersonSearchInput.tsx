import { EntitySearchInput, type EntitySearchInputProps } from './EntitySearchInput.js';

export function PersonSearchInput(props: Omit<EntitySearchInputProps, 'type'>) {
	return (
		<EntitySearchInput
			type="person"
			placeholder={props.placeholder ?? 'Search people…'}
			{...props}
		/>
	);
}

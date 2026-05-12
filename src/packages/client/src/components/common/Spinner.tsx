import { JSX } from 'preact';
import styles from './Spinner.module.scss';

interface SpinnerProps {
	size?: 'sm' | 'md' | 'lg';
	color?: string;
	/** Extra class merged onto the spinner — useful for positioning / overlay wrappers. */
	class?: string;
	/** Inline style override merged onto the spinner. `color` still wins on borderTopColor. */
	style?: JSX.CSSProperties;
	/** Accessible label; defaults to "Loading…". */
	label?: string;
}

export function Spinner({
	size = 'md',
	color,
	class: className,
	style: styleProp,
	label = 'Loading…',
}: SpinnerProps) {
	const style: JSX.CSSProperties = { ...styleProp };
	if (color) style.borderTopColor = color;

	const classes = [styles.spinner, styles[size], className].filter(Boolean).join(' ');

	return (
		<div class={classes} style={style} role="status">
			<span class="sr-only">{label}</span>
		</div>
	);
}

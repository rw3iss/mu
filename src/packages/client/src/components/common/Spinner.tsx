import styles from './Spinner.module.scss';

interface SpinnerProps {
	size?: 'sm' | 'md' | 'lg';
	color?: string;
}

export function Spinner({ size = 'md', color }: SpinnerProps) {
	const style = color ? { borderTopColor: color } : undefined;

	return (
		<div class={`${styles.spinner} ${styles[size]}`} style={style} role="status">
			<span class="sr-only">Loading...</span>
		</div>
	);
}

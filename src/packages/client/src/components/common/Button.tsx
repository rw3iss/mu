import { ComponentChildren, JSX } from 'preact';
import styles from './Button.module.scss';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
	children: ComponentChildren;
	variant?: ButtonVariant;
	size?: ButtonSize;
	disabled?: boolean;
	loading?: boolean;
	fullWidth?: boolean;
	type?: 'button' | 'submit' | 'reset';
	class?: string;
	style?: JSX.CSSProperties;
	title?: string;
	onClick?: (e: Event) => void;
	'aria-label'?: string;
}

export function Button({
	children,
	variant = 'primary',
	size = 'md',
	disabled = false,
	loading = false,
	fullWidth = false,
	type = 'button',
	class: className,
	style,
	title,
	onClick,
	...rest
}: ButtonProps) {
	const classes = [
		styles.button,
		styles[variant],
		styles[size],
		fullWidth ? styles.fullWidth : '',
		loading ? styles.loading : '',
		className || '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<button
			type={type}
			class={classes}
			style={style}
			title={title}
			disabled={disabled || loading}
			onClick={onClick}
			{...rest}
		>
			{loading && <span class={styles.spinner} />}
			<span class={loading ? styles.contentHidden : ''}>{children}</span>
		</button>
	);
}

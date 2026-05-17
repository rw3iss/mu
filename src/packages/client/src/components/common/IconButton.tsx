import type { ComponentChildren, JSX } from 'preact';
import styles from './IconButton.module.scss';

type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';
type IconButtonVariant = 'ghost' | 'subtle' | 'solid' | 'danger';

interface IconButtonProps {
	/** SVG icon (or any small visual). */
	children: ComponentChildren;
	size?: IconButtonSize;
	variant?: IconButtonVariant;
	/** Visual "on" state — e.g. for toggles. */
	active?: boolean;
	disabled?: boolean;
	type?: 'button' | 'submit';
	'aria-label': string;
	title?: string;
	class?: string;
	style?: JSX.CSSProperties;
	onClick?: (e: MouseEvent) => void;
}

/**
 * Square button with a single icon child. Bridges the
 * "<button class={controlBtn}><svg/></button>" pattern that
 * repeats across player controls, modals, and admin panels into
 * a consistent primitive.
 *
 * Sizes use a single dimension token so layout stays predictable:
 * xs=24, sm=32, md=40, lg=48 — md aligns with the 44px touch target
 * on desktop with the border/padding included.
 */
export function IconButton({
	children,
	size = 'md',
	variant = 'ghost',
	active = false,
	disabled = false,
	type = 'button',
	title,
	class: className = '',
	style,
	onClick,
	...rest
}: IconButtonProps) {
	const classes = [
		styles.btn,
		styles[`size_${size}`],
		styles[`variant_${variant}`],
		active ? styles.active : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<button
			type={type}
			class={classes}
			disabled={disabled}
			title={title}
			style={style}
			onClick={onClick}
			{...rest}
		>
			{children}
		</button>
	);
}

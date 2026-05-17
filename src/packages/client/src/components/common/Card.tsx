import type { ComponentChildren, JSX } from 'preact';
import { forwardRef } from 'preact/compat';
import styles from './Card.module.scss';

type CardVariant = 'surface' | 'elevated' | 'outlined' | 'subtle';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps {
	children: ComponentChildren;
	/** Visual treatment. `subtle` is the dashed-empty-state pattern. */
	variant?: CardVariant;
	padding?: CardPadding;
	/** Adds hover-lift + press-feedback (defers to reduce-motion). */
	interactive?: boolean;
	/** Render as a button for semantic correctness when interactive. */
	as?: 'div' | 'button' | 'a';
	href?: string;
	onClick?: (e: MouseEvent) => void;
	class?: string;
	style?: JSX.CSSProperties;
	'aria-label'?: string;
	role?: string;
	tabIndex?: number;
}

/**
 * Lightweight surface primitive used for new components — wraps the
 * common "panel with hover lift + press feedback" pattern so callers
 * don't reinvent the SCSS. Existing custom cards (MovieCard,
 * DiscoverResultCard, FavoriteCard, …) stay where they are; consider
 * migrating opportunistically when they need new variants.
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
	{
		children,
		variant = 'surface',
		padding = 'md',
		interactive = false,
		as = 'div',
		href,
		onClick,
		class: className = '',
		style,
		role,
		tabIndex,
		...rest
	},
	ref,
) {
	const classes = [
		styles.card,
		styles[`variant_${variant}`],
		styles[`padding_${padding}`],
		interactive ? styles.interactive : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	const Tag = as as any;
	return (
		<Tag
			ref={ref as never}
			class={classes}
			style={style}
			href={as === 'a' ? href : undefined}
			onClick={onClick}
			role={role}
			tabIndex={tabIndex ?? (interactive && as === 'div' ? 0 : undefined)}
			{...rest}
		>
			{children}
		</Tag>
	);
});

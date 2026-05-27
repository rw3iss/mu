import type { ComponentChildren, JSX } from 'preact';
import styles from './ToggleButton.module.scss';

interface ToggleButtonProps {
	/**
	 * When supplied, the button behaves as a two-state toggle and the
	 * fill colour indicates the current state. When omitted, the
	 * component renders as a plain pill action button — same baseline
	 * visual, no pressed state, no `aria-pressed` annotation. Used so
	 * Reset / Run-style buttons share the toggle pills' styling without
	 * misrepresenting their semantics.
	 */
	pressed?: boolean;
	onClick: () => void;
	children: ComponentChildren;
	/** Accessible label override; defaults to the children when those are
	 * a plain string. */
	'aria-label'?: string;
	/** Optional icon shown to the left of the label. */
	icon?: ComponentChildren;
	/** Visual size variant. Defaults to `sm` to match Reset-style buttons. */
	size?: 'sm' | 'md';
	/** Custom class for one-off layout / spacing tweaks. */
	class?: string;
	/** Pass-through inline style — kept for the same one-off cases as `class`. */
	style?: JSX.CSSProperties | string;
	/**
	 * When true, the button is disabled and a small spinner glyph replaces
	 * the icon slot. Use for async toggles (e.g. "Sample" while running).
	 */
	loading?: boolean;
	disabled?: boolean;
	title?: string;
}

/**
 * A small two-state pill button that visibly indicates whether a feature
 * is on. Used for things like "Spectrum" or "Visualize" inside the
 * Effects panel, where the action is a binary toggle and the state is
 * shown by colour fill.
 *
 * Pairs with a controlled `pressed` boolean from the parent — this
 * component does not own state.
 */
export function ToggleButton({
	pressed,
	onClick,
	children,
	icon,
	size = 'sm',
	class: className,
	style,
	loading = false,
	disabled,
	title,
	'aria-label': ariaLabel,
}: ToggleButtonProps) {
	const isToggle = pressed !== undefined;
	const klass = [
		styles.button,
		styles[size],
		pressed === true ? styles.pressed : '',
		loading ? styles.loading : '',
		className ?? '',
	]
		.filter(Boolean)
		.join(' ');
	return (
		<button
			type="button"
			class={klass}
			style={style}
			onClick={onClick}
			aria-pressed={isToggle ? pressed : undefined}
			aria-busy={loading || undefined}
			aria-label={ariaLabel}
			disabled={disabled || loading}
			title={title}
		>
			{loading ? (
				<span class={`${styles.icon} ${styles.spinner}`} aria-hidden="true" />
			) : (
				icon && <span class={styles.icon}>{icon}</span>
			)}
			<span>{children}</span>
		</button>
	);
}

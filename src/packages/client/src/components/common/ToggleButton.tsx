import type { ComponentChildren } from 'preact';
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
	className?: string;
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
	className,
	disabled,
	title,
	'aria-label': ariaLabel,
}: ToggleButtonProps) {
	const isToggle = pressed !== undefined;
	const klass = [
		styles.button,
		styles[size],
		pressed === true ? styles.pressed : '',
		className ?? '',
	]
		.filter(Boolean)
		.join(' ');
	return (
		<button
			type="button"
			class={klass}
			onClick={onClick}
			aria-pressed={isToggle ? pressed : undefined}
			aria-label={ariaLabel}
			disabled={disabled}
			title={title}
		>
			{icon && <span class={styles.icon}>{icon}</span>}
			<span>{children}</span>
		</button>
	);
}

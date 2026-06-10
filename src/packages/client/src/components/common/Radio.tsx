import type { ComponentChildren } from 'preact';
import styles from './Radio.module.scss';

interface RadioProps {
	checked: boolean;
	onChange: () => void;
	/** Radio group name. */
	name?: string;
	disabled?: boolean;
	/** Optional label rendered after the control. */
	children?: ComponentChildren;
	title?: string;
	class?: string;
}

/**
 * Themed radio button — larger than the native control, accent-colored ring
 * + dot. Reusable anywhere a radio group is needed.
 *
 *   <Radio name="grp" checked={v === 'a'} onChange={() => set('a')}>Option A</Radio>
 */
export function Radio({
	checked,
	onChange,
	name,
	disabled,
	children,
	title,
	class: className,
}: RadioProps) {
	return (
		<label
			class={`${styles.radio} ${disabled ? styles.disabled : ''} ${className ?? ''}`}
			title={title}
		>
			<input
				type="radio"
				name={name}
				checked={checked}
				disabled={disabled}
				onChange={onChange}
			/>
			<span class={styles.control} />
			{children != null && <span class={styles.label}>{children}</span>}
		</label>
	);
}

import type { JSX } from 'preact';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import styles from './Select.module.scss';

export interface SelectOption<T extends string | number = string> {
	value: T;
	label: string;
	/** Optional secondary line shown under the label in the open menu. */
	description?: string;
	disabled?: boolean;
}

interface SelectProps<T extends string | number = string> {
	value: T;
	options: SelectOption<T>[];
	onChange: (value: T) => void;
	id?: string;
	name?: string;
	disabled?: boolean;
	placeholder?: string;
	/** Visual size variant. Default 'md'. */
	size?: 'sm' | 'md';
	/** Use full container width. Default false. */
	fullWidth?: boolean;
	/** Extra class merged onto the trigger button. */
	class?: string;
	style?: JSX.CSSProperties;
	'aria-label'?: string;
	'aria-labelledby'?: string;
	/** Right-align the menu to the trigger's right edge. Default false (left-align). */
	menuAlign?: 'start' | 'end';
}

/**
 * Themed select replacement. Native <select> dropdown popups are
 * rendered by the OS and don't inherit theme tokens, so on dark
 * themes the option list reads as white-on-white. This component is
 * a portal-free listbox that uses the same theme variables as the
 * rest of the UI.
 *
 *  - API mirrors a controlled <select>: pass `value` + `onChange`.
 *  - Keyboard: Arrow Up/Down to move highlight, Enter to commit,
 *    Esc to cancel, type-to-jump for the first letter match.
 *  - Closes on outside click and on Esc.
 *  - Menu auto-flips above the trigger if there isn't room below.
 *  - Pass `disabled: true` on individual options to mark them
 *    non-selectable.
 */
export function Select<T extends string | number = string>({
	value,
	options,
	onChange,
	id,
	name,
	disabled = false,
	placeholder,
	size = 'md',
	fullWidth = false,
	class: className,
	style,
	'aria-label': ariaLabel,
	'aria-labelledby': ariaLabelledBy,
	menuAlign = 'start',
}: SelectProps<T>) {
	const [open, setOpen] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState<number>(() =>
		Math.max(
			0,
			options.findIndex((o) => o.value === value),
		),
	);
	const wrapRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLUListElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const typeBufferRef = useRef<{ buffer: string; timer: number | null }>({
		buffer: '',
		timer: null,
	});
	const reactId = useId();
	const listId = `select-${id ?? reactId}-list`;

	const selectedOption = useMemo(
		() => options.find((o) => o.value === value),
		[options, value],
	);

	// Sync highlight when value changes externally.
	useEffect(() => {
		const idx = options.findIndex((o) => o.value === value);
		if (idx >= 0) setHighlightIndex(idx);
	}, [value, options]);

	// Close on outside click / Esc.
	useEffect(() => {
		if (!open) return;
		const onDocPointer = (e: MouseEvent | TouchEvent) => {
			if (!wrapRef.current) return;
			if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				setOpen(false);
				triggerRef.current?.focus();
			}
		};
		document.addEventListener('mousedown', onDocPointer);
		document.addEventListener('touchstart', onDocPointer, { passive: true });
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDocPointer);
			document.removeEventListener('touchstart', onDocPointer);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	// Scroll highlighted option into view when navigating.
	useEffect(() => {
		if (!open || !menuRef.current) return;
		const el = menuRef.current.querySelector<HTMLLIElement>(
			`[data-option-index="${highlightIndex}"]`,
		);
		el?.scrollIntoView({ block: 'nearest' });
	}, [open, highlightIndex]);

	const commit = useCallback(
		(idx: number) => {
			const opt = options[idx];
			if (!opt || opt.disabled) return;
			onChange(opt.value);
			setOpen(false);
			triggerRef.current?.focus();
		},
		[options, onChange],
	);

	const moveHighlight = useCallback(
		(delta: number) => {
			if (options.length === 0) return;
			let next = highlightIndex;
			for (let i = 0; i < options.length; i++) {
				next = (next + delta + options.length) % options.length;
				if (!options[next]?.disabled) break;
			}
			setHighlightIndex(next);
		},
		[options, highlightIndex],
	);

	const onTriggerKeyDown = (e: KeyboardEvent) => {
		if (disabled) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!open) setOpen(true);
			else moveHighlight(e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (open) commit(highlightIndex);
			else setOpen(true);
		} else if (e.key === 'Home') {
			if (open) {
				e.preventDefault();
				setHighlightIndex(options.findIndex((o) => !o.disabled));
			}
		} else if (e.key === 'End') {
			if (open) {
				e.preventDefault();
				for (let i = options.length - 1; i >= 0; i--) {
					if (!options[i]?.disabled) {
						setHighlightIndex(i);
						break;
					}
				}
			}
		} else if (e.key.length === 1 && /\S/.test(e.key)) {
			// Type-to-search: buffer keys for 600ms, jump to first option
			// whose label starts with the buffer.
			if (!open) setOpen(true);
			const buf = typeBufferRef.current;
			buf.buffer += e.key.toLowerCase();
			if (buf.timer != null) window.clearTimeout(buf.timer);
			buf.timer = window.setTimeout(() => {
				buf.buffer = '';
				buf.timer = null;
			}, 600);
			const match = options.findIndex(
				(o) => !o.disabled && o.label.toLowerCase().startsWith(buf.buffer),
			);
			if (match >= 0) setHighlightIndex(match);
		}
	};

	const wrapClass = [styles.wrap, fullWidth ? styles.fullWidth : '']
		.filter(Boolean)
		.join(' ');
	const triggerClass = [
		styles.trigger,
		size === 'sm' ? styles.sm : '',
		disabled ? styles.disabled : '',
		open ? styles.open : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div ref={wrapRef} class={wrapClass} style={style}>
			{/* Hidden native input keeps the value reachable for forms. */}
			{name && <input type="hidden" name={name} value={String(value)} />}
			<button
				ref={triggerRef}
				type="button"
				id={id}
				class={triggerClass}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				onClick={() => !disabled && setOpen((v) => !v)}
				onKeyDown={onTriggerKeyDown}
			>
				<span class={styles.label}>
					{selectedOption ? selectedOption.label : (placeholder ?? '')}
				</span>
				<Icon
					name={open ? 'chevron-up' : 'chevron-down'}
					size={14}
					class={styles.chevron}
				/>
			</button>
			{open && (
				<ul
					ref={menuRef}
					id={listId}
					role="listbox"
					class={`${styles.menu} ${menuAlign === 'end' ? styles.menuEnd : ''}`}
					tabIndex={-1}
				>
					{options.length === 0 ? (
						<li class={styles.empty}>No options</li>
					) : (
						options.map((opt, idx) => {
							const selected = opt.value === value;
							const highlighted = idx === highlightIndex;
							return (
								<li
									key={String(opt.value)}
									role="option"
									aria-selected={selected}
									aria-disabled={opt.disabled || undefined}
									data-option-index={idx}
									class={[
										styles.option,
										selected ? styles.selected : '',
										highlighted ? styles.highlighted : '',
										opt.disabled ? styles.optionDisabled : '',
									]
										.filter(Boolean)
										.join(' ')}
									onMouseEnter={() => setHighlightIndex(idx)}
									onClick={() => commit(idx)}
								>
									<span class={styles.optionLabel}>{opt.label}</span>
									{opt.description && (
										<span class={styles.optionDesc}>{opt.description}</span>
									)}
									{selected && <Icon name="check" size={12} class={styles.check} />}
								</li>
							);
						})
					)}
				</ul>
			)}
		</div>
	);
}

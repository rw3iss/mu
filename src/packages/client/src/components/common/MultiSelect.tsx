import type { JSX } from 'preact';
import { useCallback, useId, useRef, useState } from 'preact/hooks';
import { usePopover } from '@/hooks/usePopover';
import { Icon } from './Icon';
import styles from './MultiSelect.module.scss';

export interface MultiSelectOption<T extends string = string> {
	value: T;
	label: string;
	/** Optional secondary line shown under the label. */
	description?: string;
	/** Optional leading icon name for the row. */
	icon?: string;
}

interface MultiSelectProps<T extends string = string> {
	options: MultiSelectOption<T>[];
	/** Currently-selected values (order-insensitive). */
	selected: T[];
	onChange: (selected: T[]) => void;
	/**
	 * When set, renders a master "All" row at the top. Checking it selects
	 * every option; checking it again (when all are selected) clears them.
	 */
	allOption?: { label: string; description?: string };
	/** Builds the trigger label from the current selection. */
	triggerLabel?: (selected: T[], options: MultiSelectOption<T>[]) => string;
	/** Leading icon shown in the trigger button. */
	leadingIcon?: string;
	size?: 'sm' | 'md';
	menuAlign?: 'start' | 'end';
	class?: string;
	style?: JSX.CSSProperties;
	'aria-label'?: string;
}

/**
 * Themed multi-select checklist dropdown. Mirrors the look of {@link Select}
 * (portal-free popover, theme tokens, keyboard support) but keeps the menu
 * open across toggles so several items can be (de)selected in one pass.
 *
 *  - Optional master "All" row: select-all when partial/none, clear-all when full.
 *  - Closes on outside click and Esc.
 *  - Keyboard: Up/Down move highlight, Enter/Space toggles, Esc closes.
 */
export function MultiSelect<T extends string = string>({
	options,
	selected,
	onChange,
	allOption,
	triggerLabel,
	leadingIcon,
	size = 'md',
	menuAlign = 'start',
	class: className,
	style,
	'aria-label': ariaLabel,
}: MultiSelectProps<T>) {
	const [open, setOpen] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState(0);
	const wrapRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const reactId = useId();
	const listId = `multiselect-${reactId}-list`;

	const handleClose = useCallback(() => {
		setOpen(false);
		triggerRef.current?.focus();
	}, []);
	usePopover({ ref: wrapRef, open, onClose: handleClose });

	const selectedSet = new Set(selected);
	const allSelected = options.length > 0 && options.every((o) => selectedSet.has(o.value));

	// Rows: index 0 = "All" master (when present), then the options.
	const allRowCount = allOption ? 1 : 0;
	const rowCount = allRowCount + options.length;

	const toggleValue = useCallback(
		(value: T) => {
			const next = new Set(selected);
			if (next.has(value)) next.delete(value);
			else next.add(value);
			// Preserve the options' declared order.
			onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
		},
		[selected, options, onChange],
	);

	const toggleAll = useCallback(() => {
		onChange(allSelected ? [] : options.map((o) => o.value));
	}, [allSelected, options, onChange]);

	const commitRow = useCallback(
		(rowIdx: number) => {
			if (allOption && rowIdx === 0) {
				toggleAll();
				return;
			}
			const opt = options[rowIdx - allRowCount];
			if (opt) toggleValue(opt.value);
		},
		[allOption, allRowCount, options, toggleAll, toggleValue],
	);

	const onTriggerKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!open) {
				setOpen(true);
				return;
			}
			setHighlightIndex(
				(i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + rowCount) % Math.max(rowCount, 1),
			);
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (open) commitRow(highlightIndex);
			else setOpen(true);
		}
	};

	const label = triggerLabel
		? triggerLabel(selected, options)
		: allOption && allSelected
			? allOption.label
			: selected.length === 0
				? 'None'
				: selected.length === 1
					? (options.find((o) => o.value === selected[0])?.label ?? '1 selected')
					: `${selected.length} selected`;

	const triggerClass = [
		styles.trigger,
		size === 'sm' ? styles.sm : '',
		open ? styles.open : '',
		className,
	]
		.filter(Boolean)
		.join(' ');

	const renderRow = (
		rowIdx: number,
		checked: boolean,
		opt: { label: string; description?: string; icon?: string },
	) => {
		const highlighted = rowIdx === highlightIndex;
		return (
			<li
				role="option"
				aria-selected={checked}
				data-row-index={rowIdx}
				class={[styles.option, highlighted ? styles.highlighted : '']
					.filter(Boolean)
					.join(' ')}
				onMouseEnter={() => setHighlightIndex(rowIdx)}
				onClick={() => commitRow(rowIdx)}
			>
				<span class={[styles.checkbox, checked ? styles.checkboxOn : ''].join(' ')}>
					{checked && <Icon name="check" size={12} />}
				</span>
				{opt.icon && <Icon name={opt.icon} size={15} class={styles.optionIcon} />}
				<span class={styles.optionText}>
					<span class={styles.optionLabel}>{opt.label}</span>
					{opt.description && <span class={styles.optionDesc}>{opt.description}</span>}
				</span>
			</li>
		);
	};

	return (
		<div ref={wrapRef} class={styles.wrap} style={style}>
			<button
				ref={triggerRef}
				type="button"
				class={triggerClass}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				aria-label={ariaLabel}
				onClick={() => setOpen((v) => !v)}
				onKeyDown={onTriggerKeyDown}
			>
				{leadingIcon && <Icon name={leadingIcon} size={15} class={styles.leadingIcon} />}
				<span class={styles.label}>{label}</span>
				<Icon
					name={open ? 'chevron-up' : 'chevron-down'}
					size={14}
					class={styles.chevron}
				/>
			</button>
			{open && (
				<ul
					id={listId}
					role="listbox"
					aria-multiselectable
					class={`${styles.menu} ${menuAlign === 'end' ? styles.menuEnd : ''}`}
					tabIndex={-1}
				>
					{allOption && (
						<>
							{renderRow(0, allSelected, allOption)}
							<li class={styles.divider} role="presentation" aria-hidden="true" />
						</>
					)}
					{options.map((opt, i) =>
						renderRow(i + allRowCount, selectedSet.has(opt.value), opt),
					)}
				</ul>
			)}
		</div>
	);
}

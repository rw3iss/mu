import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

interface NumberFilterInputProps {
	/** The committed value. `null`/`undefined` renders an empty field. */
	value: number | null | undefined;
	/** Called with the raw string once the user commits (blur or Enter). */
	onCommit: (raw: string) => void;
	/**
	 * Allow a decimal point. Switches to `type="text"` + `inputMode="decimal"`
	 * because `<input type="number">` reports `.value` as `""` for a partial
	 * entry like `"6."` (not a valid floating-point number per HTML), which makes
	 * typing a decimal impossible on a controlled input.
	 */
	decimal?: boolean;
	min?: string;
	max?: string;
	step?: string;
	placeholder?: string;
	class?: string;
	'aria-label'?: string;
}

/** Keep only what can form a number: digits plus at most one decimal point. */
function sanitize(raw: string, decimal: boolean): string {
	const cleaned = raw.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, '');
	if (!decimal) return cleaned;
	const firstDot = cleaned.indexOf('.');
	if (firstDot === -1) return cleaned;
	// Drop any dots after the first.
	return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * Numeric filter field that commits on blur/Enter instead of on every keystroke.
 *
 * The field keeps its own draft string while focused, so a re-render of the page
 * (the filters live in signals, and the library list re-renders constantly)
 * can't reset the input mid-typing — which was moving the caret to the start and
 * making decimals impossible to enter.
 */
export function NumberFilterInput({
	value,
	onCommit,
	decimal = false,
	min,
	max,
	step,
	placeholder,
	class: className,
	'aria-label': ariaLabel,
}: NumberFilterInputProps) {
	const committed = value ?? '';
	const [draft, setDraft] = useState<string>(String(committed));
	const focused = useRef(false);

	// Adopt external changes (filter cleared, restored from a URL, …) — but never
	// while the user is mid-edit, or we'd clobber what they're typing.
	useEffect(() => {
		if (!focused.current) setDraft(String(value ?? ''));
	}, [value]);

	const commit = useCallback(() => {
		const next = draft.trim();
		// Nothing changed → don't churn the filter (and refetch) on a bare focus/blur.
		if (next === String(value ?? '')) return;
		onCommit(next);
	}, [draft, value, onCommit]);

	return (
		<input
			type={decimal ? 'text' : 'number'}
			inputMode={decimal ? 'decimal' : 'numeric'}
			// min/max/step are meaningless on a text input — only set them when
			// this is a real number field.
			min={decimal ? undefined : min}
			max={decimal ? undefined : max}
			step={decimal ? undefined : step}
			class={className}
			placeholder={placeholder}
			aria-label={ariaLabel}
			value={draft}
			onFocus={() => {
				focused.current = true;
			}}
			onInput={(e) => setDraft(sanitize((e.target as HTMLInputElement).value, decimal))}
			onBlur={() => {
				focused.current = false;
				commit();
			}}
			onKeyDown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					(e.currentTarget as HTMLInputElement).blur();
				}
			}}
		/>
	);
}

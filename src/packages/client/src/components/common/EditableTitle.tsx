import type { JSX } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import styles from './EditableTitle.module.scss';
import { Icon } from './Icon';

interface EditableTitleProps {
	/** Current title text. */
	value: string;
	/** Whether the current user may edit (permission gate). When false the
	 * title renders as a plain heading with no affordance. */
	canEdit: boolean;
	/** Persist the new title. Throw to signal failure (edit mode stays open). */
	onSave: (next: string) => void | Promise<void>;
	/** Heading level. Default 1. */
	level?: 1 | 2 | 3;
	/** Class applied to BOTH the heading and the edit input so the title keeps
	 * the host page's font (size / weight / colour) in either mode. */
	class?: string;
	'aria-label'?: string;
}

/**
 * Click-to-edit title, shared by the movie-detail and group-detail pages.
 * View mode shows the heading with a hover edit pencil (when editable); clicking
 * either swaps to an input with check / cancel buttons. Enter saves, Escape
 * cancels. Empty or unchanged input just closes. The host passes its title class
 * so the input matches the heading exactly.
 */
export function EditableTitle({
	value,
	canEdit,
	onSave,
	level = 1,
	class: className,
	'aria-label': ariaLabel,
}: EditableTitleProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const start = useCallback(() => {
		if (!canEdit) return;
		setDraft(value);
		setEditing(true);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [canEdit, value]);

	const cancel = useCallback(() => setEditing(false), []);

	const save = useCallback(async () => {
		const trimmed = draft.trim();
		if (!trimmed || trimmed === value) {
			setEditing(false);
			return;
		}
		setSaving(true);
		try {
			await onSave(trimmed);
			setEditing(false);
		} catch {
			// Leave edit mode open so the user can retry; the host surfaces the error.
		} finally {
			setSaving(false);
		}
	}, [draft, value, onSave]);

	const onKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				save();
			} else if (e.key === 'Escape') {
				cancel();
			}
		},
		[save, cancel],
	);

	const Heading = `h${level}` as keyof JSX.IntrinsicElements;

	if (editing) {
		return (
			<span class={styles.editRow}>
				<input
					ref={inputRef}
					type="text"
					class={`${styles.input} ${className ?? ''}`}
					value={draft}
					onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
					onKeyDown={onKeyDown}
					disabled={saving}
					aria-label={ariaLabel ?? 'Edit title'}
				/>
				<button
					type="button"
					class={styles.saveBtn}
					onClick={save}
					disabled={saving}
					aria-label="Save title"
				>
					{saving ? '…' : <Icon name="check" size={14} />}
				</button>
				<button
					type="button"
					class={styles.cancelBtn}
					onClick={cancel}
					disabled={saving}
					aria-label="Cancel editing"
				>
					<Icon name="x" size={14} />
				</button>
			</span>
		);
	}

	if (!canEdit) {
		return <Heading class={className}>{value}</Heading>;
	}

	return (
		<span class={styles.viewWrap}>
			<Heading class={`${styles.heading} ${className ?? ''}`} onClick={start}>
				{value}
			</Heading>
			<button
				type="button"
				class={styles.editIcon}
				onClick={start}
				aria-label="Edit title"
				title="Edit title"
			>
				<Icon name="edit" size={12} />
			</button>
		</span>
	);
}

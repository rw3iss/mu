import { useState, useCallback } from 'preact/hooks';
import { getRatingColor } from '@/utils/rating-color';
import styles from './RatingWidget.module.scss';

interface RatingWidgetProps {
	value: number;
	max?: number;
	editable?: boolean;
	onChange?: (value: number) => void;
	size?: 'sm' | 'md' | 'lg';
}

export function RatingWidget({
	value,
	max = 10,
	editable = false,
	onChange,
	size = 'md',
}: RatingWidgetProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(value);

	const percentage = (value / max) * 100;

	const ratingColor = getRatingColor(value);

	const handleEdit = useCallback(() => {
		if (editable) {
			setIsEditing(true);
			setEditValue(value);
		}
	}, [editable, value]);

	const handleChange = useCallback(
		(e: Event) => {
			const target = e.target as HTMLInputElement;
			const newValue = parseFloat(target.value);
			if (!Number.isNaN(newValue) && newValue >= 0 && newValue <= max) {
				setEditValue(newValue);
			}
		},
		[max],
	);

	const handleSubmit = useCallback(() => {
		onChange?.(editValue);
		setIsEditing(false);
	}, [editValue, onChange]);

	const handleCancel = useCallback(() => {
		setIsEditing(false);
		setEditValue(value);
	}, [value]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				handleSubmit();
			} else if (e.key === 'Escape') {
				handleCancel();
			}
		},
		[handleSubmit, handleCancel],
	);

	if (isEditing) {
		return (
			<div class={`${styles.widget} ${styles[size]}`}>
				<input
					type="number"
					class={styles.input}
					value={editValue}
					onInput={handleChange}
					onKeyDown={handleKeyDown}
					onBlur={handleSubmit}
					min="0"
					max={max}
					step="0.1"
					autoFocus
				/>
				<span class={styles.maxLabel}>/ {max}</span>
			</div>
		);
	}

	return (
		<div
			class={`${styles.widget} ${styles[size]} ${editable ? styles.editable : ''}`}
			onClick={handleEdit}
			role={editable ? 'button' : undefined}
			tabIndex={editable ? 0 : undefined}
		>
			<span class={styles.value} style={{ color: ratingColor }}>
				{value > 0 ? value.toFixed(1) : '--'}
			</span>
			<div class={styles.bar}>
				<div
					class={styles.barFill}
					style={{ width: `${percentage}%`, background: ratingColor }}
				/>
			</div>
		</div>
	);
}

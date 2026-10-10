import type { EntityRef } from '@mu/shared';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { RatingWidget } from '@/components/movie/RatingWidget';
import { entitiesService, type RatingSummary } from '@/services/entities.service';
import { notifyError } from '@/state/notifications.state';
import styles from './EntityRating.module.scss';

interface EntityRatingProps {
	/** Rated entity. Named `entity` because Preact reserves the `ref` prop. */
	entity: EntityRef;
	size?: 'sm' | 'md' | 'lg';
	/** Seed from a detail payload's userRating to skip the initial flash. */
	initialUserRating?: number | null;
	/** Hide the "avg · N ratings" community line. */
	hideSummary?: boolean;
	/** Read-only (e.g. share mode). */
	readOnly?: boolean;
	class?: string;
}

/**
 * The user's 0–10 rating for any entity, on top of the shared RatingWidget.
 * Loads `rating-summary`; saving 0 (or clearing) DELETEs the rating.
 */
export function EntityRating({
	entity,
	size = 'md',
	initialUserRating,
	hideSummary,
	readOnly,
	class: className,
}: EntityRatingProps) {
	const [summary, setSummary] = useState<RatingSummary | null>(
		initialUserRating != null ? { avg: null, count: 0, userRating: initialUserRating } : null,
	);
	const key = `${entity.type}:${entity.id}`;

	useEffect(() => {
		let cancelled = false;
		entitiesService
			.ratingSummary(entity)
			.then((s) => {
				if (!cancelled) setSummary(s);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [key]);

	const handleChange = useCallback(
		async (value: number) => {
			const prev = summary;
			setSummary((s) => ({ avg: s?.avg ?? null, count: s?.count ?? 0, userRating: value }));
			try {
				if (value <= 0) await entitiesService.clearRating(entity);
				else await entitiesService.setRating(entity, value);
				const fresh = await entitiesService.ratingSummary(entity).catch(() => null);
				if (fresh) setSummary(fresh);
			} catch (err) {
				setSummary(prev);
				notifyError((err as Error)?.message || 'Failed to save rating');
			}
		},
		[key, summary],
	);

	return (
		<div class={`${styles.wrap} ${className ?? ''}`}>
			<RatingWidget
				value={summary?.userRating ?? 0}
				editable={!readOnly}
				onChange={handleChange}
				size={size}
			/>
			{!hideSummary && summary && summary.count > 0 && summary.avg != null && (
				<span
					class={styles.summary}
					title={`${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}`}
				>
					avg {summary.avg.toFixed(1)} · {summary.count}
				</span>
			)}
		</div>
	);
}

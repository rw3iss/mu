import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import type { MovieGroup } from '@/services/groups.service';
import type { ViewMode } from '@/state/library.state';
import { newTabNav } from '@/utils/navigation';
import { GroupOptionsMenu } from './GroupOptionsMenu';
import styles from './GroupTile.module.scss';
import { RatingBadge } from './RatingBadge';

interface GroupTileProps {
	group: MovieGroup;
	/**
	 * View mode the tile is rendering inside. Drives the poster aspect:
	 *   - `grid` (default): 2:3 portrait (matches MovieCard) — for the
	 *     mid-sized grid.
	 *   - `large`: 16:9 landscape with object-fit:contain — keeps every
	 *     card the same height in the large grid, even if the group's
	 *     poster is a tall format.
	 */
	viewMode?: ViewMode;
}

/**
 * Library "Collections / Series" tile. Title + count float over the top of the
 * poster, the type badge + (any) rating + options menu over the bottom — same
 * overlay treatment as the movie cards, so groups don't add height to a row.
 */
export function GroupTile({ group, viewMode = 'grid' }: GroupTileProps) {
	const subCount = group.subgroupCount ?? 0;
	const memberCount = group.totalMembers ?? 0;
	const subLabel = subCount > 1 ? `${subCount} seasons` : subCount === 1 ? '1 season' : null;
	const memberLabel =
		memberCount > 1 ? `${memberCount} items` : memberCount === 1 ? '1 item' : null;
	const countLabel = [subLabel, memberLabel].filter(Boolean).join(' · ');
	const typeLabel = group.groupType === 'collection' ? 'Collection' : 'Series';
	// Groups carry no aggregate rating today; render the row only if one ever
	// appears so the layout is ready for it.
	const rating =
		typeof (group as { rating?: number }).rating === 'number'
			? (group as { rating?: number }).rating!
			: 0;

	return (
		<div
			class={styles.tile}
			role="button"
			tabIndex={0}
			{...newTabNav(`/group/${group.id}`, () => route(`/group/${group.id}`))}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					route(`/group/${group.id}`);
				}
			}}
			title={group.name}
		>
			<div
				class={`${styles.posterWrap} ${viewMode === 'large' ? styles.posterWrapLarge : ''}`}
			>
				<SmartImage
					src={group.posterUrl ?? ''}
					alt={group.name}
					class={`${styles.poster} ${viewMode === 'large' ? styles.posterLarge : ''}`}
					fallback={
						<div class={styles.posterFallback}>
							{group.name.charAt(0).toUpperCase()}
						</div>
					}
				/>

				{/* Top scrim: title + item count */}
				<div class={styles.infoTop}>
					<div class={styles.title}>{group.name}</div>
					{countLabel && <div class={styles.count}>{countLabel}</div>}
				</div>

				{/* Bottom scrim: type badge (above any ratings) + options menu */}
				<div class={styles.infoBottom}>
					<div class={styles.typeStack}>
						<span class={styles.typeBadge}>
							<Icon name="layers" size={11} />
							{typeLabel}
						</span>
						{rating > 0 && (
							<span class={styles.ratingsRow}>
								<RatingBadge value={rating} class={styles.ratingChip} />
							</span>
						)}
					</div>
					<GroupOptionsMenu group={group} compact />
				</div>
			</div>
		</div>
	);
}

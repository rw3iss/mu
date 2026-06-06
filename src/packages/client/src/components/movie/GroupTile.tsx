import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import type { MovieGroup } from '@/services/groups.service';
import type { ViewMode } from '@/state/library.state';
import { newTabNav } from '@/utils/navigation';
import styles from './GroupTile.module.scss';

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
 * Library "Collections / Series" tile. Shows one tile per parent
 * group (a TV show like Norsemen, a collection like Lord of the
 * Rings). Clicking opens the existing `/group/:id` detail page,
 * which lists seasons / episodes / members.
 *
 * Posters: the server-side listParents endpoint borrows a member
 * movie's poster when the group itself doesn't have one set, so
 * tiles look like normal MovieCards instead of empty placeholders.
 */
export function GroupTile({ group, viewMode = 'grid' }: GroupTileProps) {
	const subCount = group.subgroupCount ?? 0;
	const memberCount = group.totalMembers ?? 0;
	const subLabel = subCount > 1 ? `${subCount} seasons` : subCount === 1 ? '1 season' : null;
	const memberLabel =
		memberCount > 1 ? `${memberCount} items` : memberCount === 1 ? '1 item' : null;

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
				<span class={styles.typeBadge}>
					<Icon name="layers" size={11} />
					{group.groupType === 'collection' ? 'Collection' : 'Series'}
				</span>
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
			</div>
			<div class={styles.body}>
				<div class={styles.title}>{group.name}</div>
				<div class={styles.meta}>
					{[subLabel, memberLabel].filter(Boolean).join(' · ') || ' '}
				</div>
			</div>
		</div>
	);
}

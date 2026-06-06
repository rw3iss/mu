import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import type { MovieGroup } from '@/services/groups.service';
import { newTabNav } from '@/utils/navigation';
import styles from './MovieListItem.module.scss';

interface GroupListItemProps {
	group: MovieGroup;
}

/**
 * List-view sibling of GroupTile. Mirrors MovieListItem's row layout
 * so groups slot in alongside movies in the library list view without
 * the eye jumping.
 */
export function GroupListItem({ group }: GroupListItemProps) {
	const subCount = group.subgroupCount ?? 0;
	const memberCount = group.totalMembers ?? 0;
	const parts = [
		group.groupType === 'collection' ? 'Collection' : 'Series',
		subCount > 1 ? `${subCount} seasons` : subCount === 1 ? '1 season' : null,
		memberCount > 1 ? `${memberCount} items` : memberCount === 1 ? '1 item' : null,
	].filter(Boolean);

	const open = () => route(`/group/${group.id}`);

	return (
		<div
			class={styles.row}
			{...newTabNav(`/group/${group.id}`, open)}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					open();
				}
			}}
			title={group.name}
		>
			<div class={styles.poster}>
				<SmartImage
					src={group.posterUrl ?? ''}
					alt={`${group.name} poster`}
					imgClass={styles.posterImage}
					fallbackLabel={group.name}
					iconOnly
				/>
			</div>

			<div class={styles.info}>
				<span class={styles.title}>
					<Icon name="layers" size={12} /> {group.name}
				</span>
				<div class={styles.meta}>
					{parts.map((p) => (
						<span key={p}>{p}</span>
					))}
				</div>
			</div>
		</div>
	);
}

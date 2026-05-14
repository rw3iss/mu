import { route } from 'preact-router';
import { SmartImage } from '@/components/common/SmartImage';
import { Icon } from '@/components/common/Icon';
import type { MovieGroup } from '@/services/groups.service';
import styles from './GroupTile.module.scss';

interface GroupTileProps {
	group: MovieGroup;
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
export function GroupTile({ group }: GroupTileProps) {
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
			onClick={() => route(`/group/${group.id}`)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					route(`/group/${group.id}`);
				}
			}}
			title={group.name}
		>
			<div class={styles.posterWrap}>
				<span class={styles.typeBadge}>
					<Icon name="layers" size={11} />
					{group.groupType === 'collection' ? 'Collection' : 'Series'}
				</span>
				<SmartImage
					src={group.posterUrl ?? ''}
					alt={group.name}
					class={styles.poster}
					fallback={
						<div class={styles.posterFallback}>{group.name.charAt(0).toUpperCase()}</div>
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

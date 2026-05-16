import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { groupsService, type MovieGroup } from '@/services/groups.service';
import styles from './MovieBreadcrumbs.module.scss';

interface MovieBreadcrumbsProps {
	movie: {
		groupId?: string | null;
		groupEpisodeOrdinal?: number | null;
	};
	/** Optional className merged onto the outer span. */
	class?: string;
	style?: JSX.CSSProperties;
	/** Whether to render the episode ordinal pill after the subgroup. Default true. */
	showEpisode?: boolean;
}

interface BreadcrumbChain {
	parent: MovieGroup | null;
	subgroup: MovieGroup;
}

/**
 * Renders "Parent → Subgroup" breadcrumb links for a movie that
 * belongs to a group hierarchy. Each pill is a router link:
 *
 *   - Parent → `/group/<parent.id>`
 *   - Subgroup → `/group/<parent.id>?subgroup=<sub.id>` (deep-link
 *     into the parent page, auto-expanding the chosen season).
 *
 * Renders nothing while loading or when the movie has no group.
 * Two GETs against `/groups/:id` — both responses are tiny so we
 * skip a dedicated breadcrumb endpoint.
 */
export function MovieBreadcrumbs({
	movie,
	class: className,
	style,
	showEpisode = true,
}: MovieBreadcrumbsProps) {
	const [chain, setChain] = useState<BreadcrumbChain | null>(null);

	useEffect(() => {
		if (!movie.groupId) {
			setChain(null);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const sub = await groupsService.get(movie.groupId!);
				const subgroup = sub.group;
				let parent: MovieGroup | null = null;
				if (subgroup.parentGroupId) {
					try {
						const p = await groupsService.get(subgroup.parentGroupId);
						parent = p.group;
					} catch {
						// Parent unreachable — render subgroup-only chain.
					}
				}
				if (!cancelled) setChain({ parent, subgroup });
			} catch {
				if (!cancelled) setChain(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [movie.groupId]);

	if (!chain) return null;

	const { parent, subgroup } = chain;
	const subgroupHref = parent
		? `/group/${parent.id}?subgroup=${subgroup.id}`
		: `/group/${subgroup.id}`;
	const cls = className ? `${styles.crumbs} ${className}` : styles.crumbs;

	const ep =
		showEpisode && movie.groupEpisodeOrdinal != null
			? `E${String(movie.groupEpisodeOrdinal).padStart(2, '0')}`
			: null;

	return (
		<span class={cls} aria-label="Group breadcrumbs">
			{parent && (
				<>
					<a
						class={styles.crumb}
						href={`/group/${parent.id}`}
						onClick={(e) => {
							e.preventDefault();
							route(`/group/${parent.id}`);
						}}
					>
						{parent.name}
					</a>
					<span class={styles.sep} aria-hidden="true">
						›
					</span>
				</>
			)}
			<a
				class={styles.crumb}
				href={subgroupHref}
				onClick={(e) => {
					e.preventDefault();
					route(subgroupHref);
				}}
			>
				{subgroup.name}
			</a>
			{ep && <span class={styles.episode}>{ep}</span>}
		</span>
	);
}

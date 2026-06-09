import { type CurrentlyWatching, type MemberSummary, resolveDisplayName } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Avatar } from '@/components/common/Avatar';
import { SmartImage } from '@/components/common/SmartImage';
import { Spinner } from '@/components/common/Spinner';
import { profileService } from '@/services/profile.service';
import { relativeTime } from '@/utils/time-format';
import styles from './MembersPage.module.scss';

interface MembersPageProps {
	path?: string;
}

export function MembersPage(_props: MembersPageProps) {
	const [members, setMembers] = useState<MemberSummary[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [unavailable, setUnavailable] = useState(false);

	useEffect(() => {
		let cancelled = false;
		profileService
			.listMembers()
			.then((r: { members: MemberSummary[] }) => {
				if (!cancelled) setMembers(r.members);
			})
			.catch(() => {
				if (!cancelled) setUnavailable(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<h1 class={styles.title}>Members</h1>
				{members && <span class={styles.count}>{members.length}</span>}
			</header>

			{loading ? (
				<div class={styles.center}>
					<Spinner size="lg" />
				</div>
			) : unavailable ? (
				<p class={styles.empty}>The member directory isn't available.</p>
			) : !members || members.length === 0 ? (
				<p class={styles.empty}>No members to show yet.</p>
			) : (
				<div class={styles.grid}>
					{members.map((m) => (
						<a
							key={m.id}
							class={styles.card}
							href={`/profile/${encodeURIComponent(m.username)}`}
						>
							<div class={styles.cardHead}>
								<Avatar name={resolveDisplayName(m)} src={m.avatarUrl} size={48} />
								<div class={styles.cardId}>
									<span class={styles.cardName}>{resolveDisplayName(m)}</span>
									<span class={styles.cardRole}>
										<span class={styles.roleText}>
											{m.role}
											{m.profilePublic === false && (
												<span class={styles.privateTag}> · private</span>
											)}
										</span>
										{m.loggedOutAt ? (
											<span class={`${styles.active} ${styles.loggedOut}`}>
												Logged out {relativeTime(m.loggedOutAt)}
											</span>
										) : m.lastActiveAt ? (
											<span class={styles.active}>Active {relativeTime(m.lastActiveAt)}</span>
										) : null}
									</span>
								</div>
							</div>
							{m.description && <p class={styles.blurb}>{m.description}</p>}
							{m.currentlyWatching && <WatchingRow watching={m.currentlyWatching} />}
							<div class={styles.cardStats}>
								<span>
									<strong>{m.favoritesCount}</strong> favorites
								</span>
								<span>
									<strong>{m.watchedCount}</strong> watched
								</span>
								<span class={styles.joined}>Joined {relativeTime(m.createdAt)}</span>
							</div>
						</a>
					))}
				</div>
			)}
		</div>
	);
}

/** Compact "watching now" row for a member card: tiny poster, title/year, seek bar. */
function WatchingRow({ watching }: { watching: CurrentlyWatching }) {
	const pct =
		watching.durationSeconds && watching.durationSeconds > 0
			? Math.min(100, Math.max(0, (watching.positionSeconds / watching.durationSeconds) * 100))
			: 0;
	return (
		<div class={styles.watching} title={`Watching ${watching.title}`}>
			<SmartImage
				src={watching.posterUrl}
				alt={watching.title}
				class={styles.watchPoster}
				fallbackLabel={watching.title}
				iconOnly
			/>
			<div class={styles.watchBody}>
				<span class={styles.watchTitle}>
					{watching.title}
					{watching.year ? <span class={styles.watchYear}> ({watching.year})</span> : null}
				</span>
				<span class={styles.watchSeek}>
					<span class={styles.watchSeekFill} style={{ width: `${pct}%` }} />
				</span>
			</div>
		</div>
	);
}

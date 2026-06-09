import type { MemberSummary } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Avatar } from '@/components/common/Avatar';
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

	const open = (username: string) => route(`/profile/${encodeURIComponent(username)}`);

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
							onClick={(e: MouseEvent) => {
								if (e.metaKey || e.ctrlKey || e.button === 1) return;
								e.preventDefault();
								open(m.username);
							}}
						>
							<div class={styles.cardHead}>
								<Avatar name={m.username} src={m.avatarUrl} size={48} />
								<div class={styles.cardId}>
									<span class={styles.cardName}>{m.username}</span>
									<span class={styles.cardRole}>
										{m.role}
										{m.profilePublic === false && <span class={styles.privateTag}> · private</span>}
									</span>
								</div>
							</div>
							{m.description ? (
								<p class={styles.blurb}>{m.description}</p>
							) : (
								<p class={styles.blurbMuted}>No description.</p>
							)}
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

import {
	DISPLAY_NAME_MAX,
	PASSWORD_MIN_LENGTH,
	PROFILE_DESCRIPTION_MAX,
	type ProfileView,
	resolveDisplayName,
} from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Avatar } from '@/components/common/Avatar';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Panel } from '@/components/common/Panel';
import { Spinner } from '@/components/common/Spinner';
import { ToggleButton } from '@/components/common/ToggleButton';
import { ProfileComments } from '@/components/profile/ProfileComments';
import { ProfileFavorites } from '@/components/profile/ProfileFavorites';
import { ProfileHistoryList } from '@/components/profile/ProfileHistoryList';
import { WatchingNow } from '@/components/profile/WatchingNow';
import { profileService } from '@/services/profile.service';
import { currentUser, isAdmin } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { showUsersInfo } from '@/state/system.state';
import { relativeTime } from '@/utils/time-format';
import styles from './ProfilePage.module.scss';

interface ProfilePageProps {
	path?: string;
	/** Present on /profile/:username (the read view); absent on /profile (edit). */
	username?: string;
}

export function ProfilePage({ username }: ProfilePageProps) {
	const editMode = !username;

	const [data, setData] = useState<ProfileView | null>(null);
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);

	// Edit drafts (only used when editMode).
	const [descDraft, setDescDraft] = useState('');
	const [displayNameDraft, setDisplayNameDraft] = useState('');
	const [usernameDraft, setUsernameDraft] = useState('');
	const [emailDraft, setEmailDraft] = useState('');
	const [saving, setSaving] = useState(false);
	const [commentCount, setCommentCount] = useState<number | null>(null);
	const [uploadingAvatar, setUploadingAvatar] = useState(false);
	const [togglingPublic, setTogglingPublic] = useState(false);

	// Admin moderation: disable / re-enable another user's account.
	const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
	const [moderating, setModerating] = useState(false);

	// Change-password form (hidden until toggled open).
	const [pwOpen, setPwOpen] = useState(false);
	const [pwNew, setPwNew] = useState('');
	const [pwConfirm, setPwConfirm] = useState('');
	const [changingPw, setChangingPw] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setNotFound(false);
		const load = username ? profileService.getByUsername(username) : profileService.getMine();
		load.then((view: ProfileView) => {
			if (cancelled) return;
			setData(view);
			setDescDraft(view.user.description ?? '');
			setDisplayNameDraft(view.user.displayName ?? '');
			setUsernameDraft(view.user.username);
			setEmailDraft(view.user.email ?? '');
		})
			.catch(() => {
				if (!cancelled) setNotFound(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [username]);

	const isSelf = !!data && currentUser.value?.id === data.user.id;
	const dirty =
		!!data &&
		(descDraft !== (data.user.description ?? '') ||
			displayNameDraft !== (data.user.displayName ?? '') ||
			usernameDraft !== data.user.username ||
			emailDraft !== (data.user.email ?? ''));

	async function handleSave() {
		if (!data) return;
		setSaving(true);
		try {
			const view = await profileService.updateMine({
				description: descDraft,
				displayName: displayNameDraft.trim() || null,
				username: usernameDraft.trim(),
				email: emailDraft.trim() || null,
			});
			setData(view);
			notifySuccess('Profile saved');
		} catch (err) {
			notifyError((err as Error)?.message || 'Could not save profile');
		} finally {
			setSaving(false);
		}
	}

	const pwTooShort = pwNew.length > 0 && pwNew.length < PASSWORD_MIN_LENGTH;
	const pwMismatch = pwConfirm.length > 0 && pwNew !== pwConfirm;
	const pwValid = pwNew.length >= PASSWORD_MIN_LENGTH && pwNew === pwConfirm;

	function resetPasswordForm() {
		setPwOpen(false);
		setPwNew('');
		setPwConfirm('');
	}

	async function handleChangePassword() {
		if (!pwValid) return;
		setChangingPw(true);
		try {
			await profileService.changePassword(pwNew);
			notifySuccess('Password changed');
			resetPasswordForm();
		} catch (err) {
			notifyError((err as Error)?.message || 'Could not change password');
		} finally {
			setChangingPw(false);
		}
	}

	async function handleAvatarSelect(file: File) {
		setUploadingAvatar(true);
		try {
			const view = await profileService.uploadAvatar(file);
			setData(view);
			notifySuccess('Avatar updated');
		} catch (err) {
			notifyError((err as Error)?.message || 'Could not upload avatar');
		} finally {
			setUploadingAvatar(false);
		}
	}

	async function handleTogglePublic() {
		if (!data) return;
		const next = !data.user.profilePublic;
		setTogglingPublic(true);
		try {
			const view = await profileService.updateMine({ profilePublic: next });
			setData(view);
			notifySuccess(next ? 'Profile is now visible to others' : 'Profile is now private');
		} catch (err) {
			notifyError((err as Error)?.message || 'Could not update visibility');
		} finally {
			setTogglingPublic(false);
		}
	}

	async function handleToggleDisabled() {
		if (!data) return;
		const next = !data.user.disabled;
		setModerating(true);
		try {
			const view = await profileService.setUserDisabled(data.user.username, next);
			setData(view);
			notifySuccess(next ? 'Account disabled' : 'Account enabled');
			setConfirmDisableOpen(false);
		} catch (err) {
			notifyError((err as Error)?.message || 'Could not update the account');
		} finally {
			setModerating(false);
		}
	}

	if (loading) {
		return (
			<div class={styles.page}>
				<div class={styles.loading}>
					<Spinner size="lg" />
				</div>
			</div>
		);
	}

	if (notFound || !data) {
		return (
			<div class={styles.page}>
				<Panel>
					<div class={styles.notFound}>
						<h1>Profile unavailable</h1>
						<p>This profile doesn't exist or its owner has kept it private.</p>
						<Button variant="secondary" onClick={() => route('/')}>
							Back home
						</Button>
					</div>
				</Panel>
			</div>
		);
	}

	const { user, stats, favorites, history, currentlyWatching } = data;
	// Admins may disable/enable any account other than their own, from the
	// read view of that user's profile.
	const canModerate = !editMode && isAdmin.value && !isSelf;
	const userDisabled = !!user.disabled;

	return (
		<div class={styles.page}>
			{/* Back to the member directory (read view only). */}
			{!editMode && (
				<a class={styles.backLink} href="/members">
					← Members
				</a>
			)}
			{/* Edit view: jump to your public profile (same slot/style). */}
			{editMode && (
				<a
					class={styles.backLink}
					href={`/profile/${user.username}`}
					title="See your profile as other members see it"
				>
					← View
				</a>
			)}

			{/* ── Header / identity ───────────────────────────────── */}
			<Panel class={styles.headerPanel}>
				<div class={styles.identity}>
					<Avatar
						name={
							editMode
								? resolveDisplayName({
										displayName: displayNameDraft,
										username: usernameDraft,
									})
								: resolveDisplayName(user)
						}
						src={user.avatarUrl}
						size={132}
						editable={editMode}
						uploading={uploadingAvatar}
						onSelectFile={handleAvatarSelect}
					/>
					<div class={styles.identityMain}>
						{editMode ? (
							<input
								class={styles.nameInput}
								value={usernameDraft}
								onInput={(e) =>
									setUsernameDraft((e.target as HTMLInputElement).value)
								}
								aria-label="Username"
							/>
						) : (
							<h1 class={styles.name}>{resolveDisplayName(user)}</h1>
						)}
						<div class={styles.subline}>
							<span class={styles.role}>{user.role}</span>
							<span class={styles.dotSep}>·</span>
							<span>Joined {relativeTime(stats.joinedAt)}</span>
							{stats.loggedOutAt ? (
								<>
									<span class={styles.dotSep}>·</span>
									<span>Logged out {relativeTime(stats.loggedOutAt)}</span>
								</>
							) : stats.lastActiveAt ? (
								<>
									<span class={styles.dotSep}>·</span>
									<span>Active {relativeTime(stats.lastActiveAt)}</span>
								</>
							) : null}
						</div>
						<div class={styles.stats}>
							<span class={styles.stat}>
								<strong>{stats.favoritesCount}</strong> favorites
							</span>
							<span class={styles.stat}>
								<strong>{stats.watchedCount}</strong> watched
							</span>
						</div>
					</div>
					{/* Action column — Edit / visibility lives in the header row itself
					    (across from the name) instead of a separate panel header,
					    which removes the gap above the identity block. */}
					{editMode && showUsersInfo.value ? (
						<div class={styles.identityActions}>
							<ToggleButton
								pressed={!!user.profilePublic}
								loading={togglingPublic}
								onClick={handleTogglePublic}
								title="Control whether other members can see your profile"
							>
								{user.profilePublic ? 'Profile is public' : 'Show Profile Info'}
							</ToggleButton>
						</div>
					) : !editMode && isSelf ? (
						<div class={styles.identityActions}>
							<Button variant="secondary" size="sm" onClick={() => route('/profile')}>
								Edit profile
							</Button>
						</div>
					) : canModerate ? (
						<div class={styles.identityActions}>
							{userDisabled ? (
								<div class={styles.disabledControl}>
									<span class={styles.disabledBadge}>Account disabled</span>
									<Button
										variant="secondary"
										size="sm"
										onClick={() => setConfirmDisableOpen(true)}
									>
										Enable
									</Button>
								</div>
							) : (
								<Button
									variant="danger"
									size="sm"
									onClick={() => setConfirmDisableOpen(true)}
								>
									Disable
								</Button>
							)}
						</div>
					) : null}
				</div>

				{/* Editable basic info */}
				{editMode && (
					<div class={styles.editFields}>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Display name</span>
							<input
								class={styles.input}
								value={displayNameDraft}
								maxLength={DISPLAY_NAME_MAX}
								placeholder="Shown across the site (defaults to your username)"
								onInput={(e) =>
									setDisplayNameDraft((e.target as HTMLInputElement).value)
								}
							/>
						</label>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Email</span>
							<input
								class={styles.input}
								type="email"
								value={emailDraft}
								onInput={(e) => setEmailDraft((e.target as HTMLInputElement).value)}
							/>
						</label>
					</div>
				)}

				{/* Description / blurb */}
				<div class={styles.blurb}>
					{editMode ? (
						<label class={styles.field}>
							<span class={styles.fieldLabel}>
								About you
								<span class={styles.counter}>
									{descDraft.length}/{PROFILE_DESCRIPTION_MAX}
								</span>
							</span>
							<textarea
								class={styles.textarea}
								value={descDraft}
								maxLength={PROFILE_DESCRIPTION_MAX}
								rows={3}
								placeholder="A short blurb about your taste in film…"
								onInput={(e) =>
									setDescDraft((e.target as HTMLTextAreaElement).value)
								}
							/>
						</label>
					) : user.description ? (
						<p class={styles.description}>{user.description}</p>
					) : (
						<p class={styles.descriptionMuted}>No description yet.</p>
					)}
				</div>

				{editMode && (
					<>
						<div class={styles.saveRow}>
							<Button
								variant="secondary"
								onClick={() => (pwOpen ? resetPasswordForm() : setPwOpen(true))}
							>
								Change password
							</Button>
							<Button
								variant="primary"
								loading={saving}
								disabled={!dirty}
								onClick={handleSave}
							>
								Save changes
							</Button>
						</div>

						{pwOpen && (
							<div class={styles.passwordForm}>
								<label class={styles.field}>
									<span class={styles.fieldLabel}>New password</span>
									<input
										class={styles.input}
										type="password"
										autocomplete="new-password"
										value={pwNew}
										onInput={(e) =>
											setPwNew((e.target as HTMLInputElement).value)
										}
									/>
								</label>
								<label class={styles.field}>
									<span class={styles.fieldLabel}>Confirm password</span>
									<input
										class={styles.input}
										type="password"
										autocomplete="new-password"
										value={pwConfirm}
										onInput={(e) =>
											setPwConfirm((e.target as HTMLInputElement).value)
										}
									/>
								</label>
								{(pwTooShort || pwMismatch) && (
									<span class={styles.pwError}>
										{pwTooShort
											? `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
											: 'Passwords do not match'}
									</span>
								)}
								<div class={styles.passwordActions}>
									<Button
										variant="ghost"
										size="sm"
										onClick={resetPasswordForm}
										disabled={changingPw}
									>
										Cancel
									</Button>
									<Button
										variant="primary"
										size="sm"
										loading={changingPw}
										disabled={!pwValid}
										onClick={handleChangePassword}
									>
										Change
									</Button>
								</div>
							</div>
						)}
					</>
				)}
			</Panel>

			{/* ── Two columns: main (Watching now, Favorites, Recently watched)
			      and a Comments sidebar (hidden when the user has none). ── */}
			<div class={styles.sectionsColumns}>
				<div class={styles.sectionsMain}>
					{currentlyWatching && <WatchingNow watching={currentlyWatching} />}

					<Panel
						collapsible
						title="Favorites"
						subtitle="Movies, cast, and directors — earliest first"
						bodyClass={styles.scrollBody}
					>
						<ProfileFavorites favorites={favorites} />
					</Panel>

					<Panel
						collapsible
						title="Recently watched"
						subtitle={`${history.length} ${history.length === 1 ? 'movie' : 'movies'}`}
						bodyClass={styles.scrollBody}
					>
						<ProfileHistoryList history={history} />
					</Panel>
				</div>

				{/* Mounted even before the count is known so the fetch runs;
				    shown only when the user actually has comments. */}
				<div
					class={`${styles.sectionsSide} ${commentCount === 0 || commentCount === null ? styles.sectionsSideHidden : ''}`}
				>
					<Panel collapsible title="Comments">
						<ProfileComments userId={user.id} onCount={setCommentCount} />
					</Panel>
				</div>
			</div>

			{canModerate && (
				<ConfirmDialog
					isOpen={confirmDisableOpen}
					onClose={() => setConfirmDisableOpen(false)}
					onConfirm={handleToggleDisabled}
					loading={moderating}
					variant={userDisabled ? 'primary' : 'danger'}
					title={userDisabled ? 'Enable account' : 'Disable account'}
					confirmLabel={userDisabled ? 'Enable' : 'Disable'}
					message={
						userDisabled
							? `Re-enable ${resolveDisplayName(user)}? They'll be able to log in again.`
							: `Disable ${resolveDisplayName(user)}? They'll be signed out immediately and blocked from logging in until an admin re-enables the account.`
					}
				/>
			)}
		</div>
	);
}

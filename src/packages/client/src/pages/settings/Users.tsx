import { type RegistrationConfig, resolveDisplayName, type UserRole } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Select } from '@/components/common/Select';
import { ToggleButton } from '@/components/common/ToggleButton';
import { useConfirm } from '@/hooks/useConfirm';
import { api } from '@/services/api';
import { authService } from '@/services/auth.service';
import { profileService } from '@/services/profile.service';
import { currentUser } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import {
	loadRegistrationConfig,
	registrationConfig,
	setRegistrationConfigLocal,
} from '@/state/registration.state';
import { setShowUsersInfoLocal, showUsersInfo } from '@/state/system.state';
import styles from './Users.module.scss';

interface UserRow {
	id: string;
	username: string;
	displayName?: string | null;
	email: string | null;
	role: UserRole;
	disabled?: boolean;
	/** Self-registration gates — false only for pending public sign-ups. */
	approved?: boolean;
	emailVerified?: boolean;
	createdAt: string;
	updatedAt: string;
}

const ROLE_OPTIONS: { label: string; value: UserRole }[] = [
	{ label: 'Admin', value: 'admin' },
	{ label: 'Contributor', value: 'contributor' },
	{ label: 'Viewer', value: 'viewer' },
];

/**
 * Admin Users panel. Lists every user, lets admins create new ones,
 * change roles, reset passwords, and delete. Last-admin protection is
 * enforced server-side — we surface the 409 as a notification.
 */
export function Users() {
	const [users, setUsers] = useState<UserRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [editPassword, setEditPassword] = useState<UserRow | null>(null);
	const [savingSystem, setSavingSystem] = useState(false);
	const [savingRegistration, setSavingRegistration] = useState(false);
	const { confirm, dialog } = useConfirm();

	const me = currentUser.value;

	const toggleShowUsersInfo = async () => {
		const next = !showUsersInfo.value;
		setSavingSystem(true);
		try {
			await profileService.setSystemConfig(next);
			setShowUsersInfoLocal(next);
			notifySuccess(
				next ? 'Members are now visible to users' : 'Member info is now hidden from users',
			);
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to update setting');
		} finally {
			setSavingSystem(false);
		}
	};

	/**
	 * Persist one registration switch. Sends the WHOLE config (the endpoint
	 * takes all three) built from the current signal + this change, then mirrors
	 * the server's response locally.
	 */
	const updateRegistration = async (patch: Partial<RegistrationConfig>) => {
		const next = { ...registrationConfig.value, ...patch };
		setSavingRegistration(true);
		try {
			const saved = await authService.setRegistrationConfig(next);
			setRegistrationConfigLocal(saved);
			notifySuccess('Registration settings updated');
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to update registration settings');
		} finally {
			setSavingRegistration(false);
		}
	};

	const approve = async (u: UserRow) => {
		setBusy(u.id);
		try {
			await api.post(`/users/${u.id}/approve`, {});
			notifySuccess(`Approved ${u.username}`);
			await refresh();
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to approve user');
		} finally {
			setBusy(null);
		}
	};

	const refresh = async () => {
		setLoading(true);
		try {
			const rows = await api.get<UserRow[]>('/users');
			setUsers(rows);
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to load users');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void refresh();
		void loadRegistrationConfig(true);
	}, []);

	const changeRole = async (u: UserRow, role: UserRole) => {
		if (u.role === role) return;
		if (u.role === 'admin' && role !== 'admin') {
			const ok = await confirm({
				title: 'Demote admin?',
				message: `Demote ${u.username} from admin to ${role}? If this is the last admin, the change will be refused.`,
				confirmLabel: 'Demote',
				variant: 'danger',
			});
			if (!ok) return;
		}
		setBusy(u.id);
		try {
			await api.patch(`/users/${u.id}`, { role });
			notifySuccess(`Updated ${u.username} → ${role}`);
			await refresh();
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to change role');
		} finally {
			setBusy(null);
		}
	};

	const toggleDisabled = async (u: UserRow) => {
		if (u.id === me?.id) {
			notifyError('You can’t disable your own account');
			return;
		}
		const next = !u.disabled;
		const ok = await confirm({
			title: next ? 'Disable user?' : 'Enable user?',
			message: next
				? `Disable ${u.username}? They'll be signed out immediately and blocked from logging in until re-enabled.`
				: `Enable ${u.username}? They'll be able to log in again.`,
			confirmLabel: next ? 'Disable' : 'Enable',
			variant: next ? 'danger' : 'primary',
		});
		if (!ok) return;
		setBusy(u.id);
		try {
			await profileService.setUserDisabled(u.username, next);
			notifySuccess(next ? `Disabled ${u.username}` : `Enabled ${u.username}`);
			await refresh();
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to update account');
		} finally {
			setBusy(null);
		}
	};

	const remove = async (u: UserRow) => {
		if (u.id === me?.id) {
			notifyError('You can’t delete your own account from this page');
			return;
		}
		const ok = await confirm({
			title: 'Delete user?',
			message: `Delete user ${u.username}? This cannot be undone.`,
			confirmLabel: 'Delete',
			variant: 'danger',
		});
		if (!ok) return;
		setBusy(u.id);
		try {
			await api.delete(`/users/${u.id}`);
			notifySuccess(`Deleted ${u.username}`);
			await refresh();
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to delete user');
		} finally {
			setBusy(null);
		}
	};

	return (
		<div class={styles.wrap}>
			<div class={styles.intro}>
				<h2 class={styles.heading}>Users</h2>
				<p class={styles.lede}>
					Manage who can sign in. Viewers can search + play; contributors can also edit
					movies; admins control everything including app settings, plugins, and the user
					list itself.
				</p>
			</div>

			<div class={styles.systemToggle}>
				<div class={styles.systemToggleInfo}>
					<span class={styles.systemToggleLabel}>Show Users Info</span>
					<span class={styles.systemToggleDesc}>
						When enabled, a <strong>Members</strong> item appears in the sidebar and
						users can view each other's profiles, favorites, and watch activity — but
						only for members who have made their profile public. Admins always see
						everyone. When disabled, member info is hidden from non-admins.
					</span>
				</div>
				<ToggleButton
					pressed={showUsersInfo.value}
					loading={savingSystem}
					onClick={toggleShowUsersInfo}
				>
					{showUsersInfo.value ? 'Enabled' : 'Disabled'}
				</ToggleButton>
			</div>

			{/* ── Self-registration ─────────────────────────────────────────
			    The two sub-options only exist while registration is open, so
			    they're rendered conditionally rather than shown disabled. */}
			<div class={styles.systemToggle}>
				<div class={styles.systemToggleInfo}>
					<span class={styles.systemToggleLabel}>Allow new user registration</span>
					<span class={styles.systemToggleDesc}>
						When enabled, a <strong>Register a new account</strong> button appears on
						the sign-in page and anyone who can reach this server can create an account.
						New accounts are always created as <strong>viewers</strong>.
					</span>
				</div>
				<ToggleButton
					pressed={registrationConfig.value.allowRegistration}
					loading={savingRegistration}
					onClick={() =>
						updateRegistration({
							allowRegistration: !registrationConfig.value.allowRegistration,
						})
					}
				>
					{registrationConfig.value.allowRegistration ? 'Enabled' : 'Disabled'}
				</ToggleButton>
			</div>

			{registrationConfig.value.allowRegistration && (
				<>
					<div class={`${styles.systemToggle} ${styles.systemToggleNested}`}>
						<div class={styles.systemToggleInfo}>
							<span class={styles.systemToggleLabel}>Require admin approval</span>
							<span class={styles.systemToggleDesc}>
								New accounts can't sign in until an admin approves them here.
								Pending accounts appear in the list below with an
								<strong> Approve</strong> button.
							</span>
						</div>
						<ToggleButton
							pressed={registrationConfig.value.requireApproval}
							loading={savingRegistration}
							onClick={() =>
								updateRegistration({
									requireApproval: !registrationConfig.value.requireApproval,
								})
							}
						>
							{registrationConfig.value.requireApproval ? 'Enabled' : 'Disabled'}
						</ToggleButton>
					</div>

					<div class={`${styles.systemToggle} ${styles.systemToggleNested}`}>
						<div class={styles.systemToggleInfo}>
							<span class={styles.systemToggleLabel}>Require email verification</span>
							<span class={styles.systemToggleDesc}>
								New accounts must click a link emailed to them before they can sign
								in. Requires a configured email provider — until one is set up the
								verification link is written to the server log, and approving an
								account here also clears its email requirement.
							</span>
						</div>
						<ToggleButton
							pressed={registrationConfig.value.requireEmailVerification}
							loading={savingRegistration}
							onClick={() =>
								updateRegistration({
									requireEmailVerification:
										!registrationConfig.value.requireEmailVerification,
								})
							}
						>
							{registrationConfig.value.requireEmailVerification
								? 'Enabled'
								: 'Disabled'}
						</ToggleButton>
					</div>
				</>
			)}

			<div class={styles.toolbar}>
				<span>
					{loading ? 'Loading…' : `${users.length} user${users.length === 1 ? '' : 's'}`}
				</span>
				<Button onClick={() => setShowAdd(true)}>Add user</Button>
			</div>

			<table class={styles.table}>
				<thead>
					<tr>
						<th>Username</th>
						<th>Email</th>
						<th>Role</th>
						<th>Created</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{users.map((u) => (
						<tr key={u.id}>
							<td>
								{resolveDisplayName(u)}
								{u.displayName?.trim() && u.displayName.trim() !== u.username ? (
									<span class={styles.subtle}> @{u.username}</span>
								) : null}
								{u.id === me?.id ? <span class={styles.selfBadge}>you</span> : null}
								{u.approved === false ? (
									<span class={styles.pendingBadge}>pending approval</span>
								) : u.emailVerified === false ? (
									<span class={styles.pendingBadge}>unverified</span>
								) : null}
							</td>
							<td>{u.email ?? '—'}</td>
							<td>
								<Select<UserRole>
									className={styles.roleSelect}
									value={u.role}
									options={ROLE_OPTIONS}
									disabled={busy === u.id}
									onChange={(role) => changeRole(u, role)}
								/>
							</td>
							<td>{new Date(u.createdAt).toLocaleDateString()}</td>
							<td>
								<div class={styles.actions}>
									{(u.approved === false || u.emailVerified === false) && (
										<div class={styles.actionRow}>
											<button
												type="button"
												class={styles.linkButton}
												disabled={busy === u.id}
												onClick={() => approve(u)}
											>
												Approve
											</button>
										</div>
									)}
									<div class={styles.actionRow}>
										<button
											type="button"
											class={styles.linkButton}
											disabled={busy === u.id}
											onClick={() => setEditPassword(u)}
										>
											Reset password
										</button>
									</div>
									<div class={styles.actionRow}>
										<button
											type="button"
											class={`${styles.linkButton} ${u.disabled ? '' : styles.danger}`}
											disabled={busy === u.id || u.id === me?.id}
											onClick={() => toggleDisabled(u)}
										>
											{u.disabled ? 'Enable' : 'Disable'}
										</button>
										<button
											type="button"
											class={`${styles.linkButton} ${styles.danger}`}
											disabled={busy === u.id || u.id === me?.id}
											onClick={() => remove(u)}
										>
											Delete
										</button>
									</div>
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{showAdd ? (
				<AddUserModal
					onClose={() => setShowAdd(false)}
					onCreated={() => {
						setShowAdd(false);
						void refresh();
					}}
				/>
			) : null}
			{editPassword ? (
				<ResetPasswordModal
					user={editPassword}
					onClose={() => setEditPassword(null)}
					onDone={() => setEditPassword(null)}
				/>
			) : null}
			{dialog}
		</div>
	);
}

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [role, setRole] = useState<UserRole>('viewer');
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const submit = async (e: Event) => {
		e.preventDefault();
		if (!username.trim() || !password) {
			setError('Username and password are required');
			return;
		}
		setError('');
		setSubmitting(true);
		try {
			await api.post('/users', {
				username: username.trim(),
				email: email.trim() || undefined,
				password,
				role,
			});
			notifySuccess(`Created ${username}`);
			onCreated();
		} catch (err: any) {
			setError(err?.message ?? 'Failed to create user');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div class={styles.modalBackdrop} onClick={onClose}>
			<form class={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
				<h3 class={styles.modalTitle}>Add user</h3>
				<div class={styles.formRow}>
					<label class={styles.formLabel} for="add-username">
						Username
					</label>
					<input
						id="add-username"
						class={styles.input}
						value={username}
						onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
						autoFocus
					/>
				</div>
				<div class={styles.formRow}>
					<label class={styles.formLabel} for="add-email">
						Email (optional)
					</label>
					<input
						id="add-email"
						type="email"
						class={styles.input}
						value={email}
						onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
					/>
				</div>
				<div class={styles.formRow}>
					<label class={styles.formLabel} for="add-password">
						Password
					</label>
					<input
						id="add-password"
						type="password"
						class={styles.input}
						value={password}
						onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
					/>
				</div>
				<div class={styles.formRow}>
					<label class={styles.formLabel}>Role</label>
					<Select<UserRole>
						value={role}
						options={ROLE_OPTIONS}
						onChange={(v) => setRole(v)}
					/>
				</div>
				{error ? <div class={styles.errorText}>{error}</div> : null}
				<div class={styles.modalActions}>
					<Button variant="secondary" type="button" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={submitting}>
						{submitting ? 'Creating…' : 'Create'}
					</Button>
				</div>
			</form>
		</div>
	);
}

function ResetPasswordModal({
	user,
	onClose,
	onDone,
}: {
	user: UserRow;
	onClose: () => void;
	onDone: () => void;
}) {
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const submit = async (e: Event) => {
		e.preventDefault();
		if (!password) {
			setError('Enter a new password');
			return;
		}
		setError('');
		setSubmitting(true);
		try {
			await api.patch(`/users/${user.id}`, { password });
			notifySuccess(`Reset password for ${user.username}`);
			onDone();
		} catch (err: any) {
			setError(err?.message ?? 'Failed to reset password');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div class={styles.modalBackdrop} onClick={onClose}>
			<form class={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
				<h3 class={styles.modalTitle}>Reset password — {user.username}</h3>
				<div class={styles.formRow}>
					<label class={styles.formLabel} for="reset-password">
						New password
					</label>
					<input
						id="reset-password"
						type="password"
						class={styles.input}
						value={password}
						onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
						autoFocus
					/>
				</div>
				{error ? <div class={styles.errorText}>{error}</div> : null}
				<div class={styles.modalActions}>
					<Button variant="secondary" type="button" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={submitting}>
						{submitting ? 'Saving…' : 'Save'}
					</Button>
				</div>
			</form>
		</div>
	);
}

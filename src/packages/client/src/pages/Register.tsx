import {
	isValidEmail,
	PASSWORD_RULE_TEXT,
	type RegistrationResult,
	validatePassword,
	validateUsername,
} from '@mu/shared';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { authService } from '@/services/auth.service';
import { isAuthenticated } from '@/state/auth.state';
import { notifyError } from '@/state/notifications.state';
import {
	loadRegistrationConfig,
	registrationConfig,
	registrationConfigLoaded,
} from '@/state/registration.state';
// The auth-screen shell is shared with the login page — reused, not cloned.
import auth from './Login.module.scss';
import styles from './Register.module.scss';

interface RegisterProps {
	path?: string;
}

interface FieldErrors {
	username?: string;
	email?: string;
	password?: string;
	confirmPassword?: string;
}

/**
 * Public self-registration form. Only reachable when an admin has enabled
 * registration — otherwise it explains that and links back to sign-in.
 *
 * Validation runs client-side first (same shared rules the server enforces) so
 * the user gets instant feedback; uniqueness of username/email can only be
 * decided by the server, whose 409 is surfaced on the relevant field.
 */
export function Register(_props: RegisterProps) {
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [error, setError] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [result, setResult] = useState<RegistrationResult | null>(null);

	// Signed-out screen — bounce anyone already authenticated (post-render, as
	// route() during render doesn't reliably navigate).
	useEffect(() => {
		if (isAuthenticated.value) route('/', true);
	}, [isAuthenticated.value]);

	useEffect(() => {
		void loadRegistrationConfig();
	}, []);

	const validate = useCallback((): FieldErrors => {
		const errors: FieldErrors = {};
		const usernameError = validateUsername(username);
		if (usernameError) errors.username = usernameError;
		if (!email.trim()) errors.email = 'Email address is required.';
		else if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
		const passwordError = validatePassword(password);
		if (passwordError) errors.password = passwordError;
		if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
		return errors;
	}, [username, email, password, confirmPassword]);

	const handleSubmit = useCallback(
		async (e: Event) => {
			e.preventDefault();
			setError('');

			const errors = validate();
			setFieldErrors(errors);
			if (Object.keys(errors).length > 0) return;

			setIsLoading(true);
			try {
				const res = await authService.register({
					username: username.trim(),
					email: email.trim(),
					displayName: displayName.trim() || undefined,
					password,
				});
				setResult(res);
			} catch (err: any) {
				const message = err?.message ?? 'Registration failed';
				// Point the conflict at the field it belongs to.
				const lower = String(message).toLowerCase();
				if (lower.includes('username')) setFieldErrors({ username: message });
				else if (lower.includes('email')) setFieldErrors({ email: message });
				setError(message);
				notifyError(message);
			} finally {
				setIsLoading(false);
			}
		},
		[validate, username, email, displayName, password],
	);

	const goToLogin = () => route('/login');

	// ── Registration disabled ──────────────────────────────────────────────
	if (registrationConfigLoaded.value && !registrationConfig.value.allowRegistration) {
		return (
			<div class={auth.page}>
				<div class={auth.card}>
					<div class={auth.header}>
						<div class={auth.logo}>M</div>
						<h1 class={auth.title}>Registration closed</h1>
						<p class={auth.subtitle}>
							This server isn’t accepting new accounts right now. Ask an administrator
							for an invitation.
						</p>
					</div>
					<Button variant="primary" size="lg" fullWidth onClick={goToLogin}>
						Back to sign in
					</Button>
				</div>
			</div>
		);
	}

	// ── Created ────────────────────────────────────────────────────────────
	if (result) {
		return (
			<div class={auth.page}>
				<div class={auth.card}>
					<div class={styles.success}>
						<div class={styles.successIcon}>
							<Icon name="check" size={24} />
						</div>
						<h1 class={styles.successTitle}>Account created</h1>
						<p class={styles.successMessage}>{result.message}</p>
						<Button variant="primary" size="lg" fullWidth onClick={goToLogin}>
							Go to sign in
						</Button>
					</div>
				</div>
			</div>
		);
	}

	// ── Form ───────────────────────────────────────────────────────────────
	return (
		<div class={auth.page}>
			<div class={auth.card}>
				<div class={auth.header}>
					<div class={auth.logo}>M</div>
					<h1 class={auth.title}>Create your account</h1>
					<p class={auth.subtitle}>Join this Mu server</p>
				</div>

				<form class={auth.form} onSubmit={handleSubmit}>
					{error && <div class={auth.error}>{error}</div>}

					<div class={auth.field}>
						<label class={auth.label} htmlFor="username">
							Username<span class={styles.required}>*</span>
						</label>
						<input
							id="username"
							type="text"
							class={auth.input}
							value={username}
							onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
							placeholder="Choose a username"
							autoComplete="username"
							autoFocus
							required
						/>
						{fieldErrors.username && (
							<span class={styles.fieldError}>{fieldErrors.username}</span>
						)}
					</div>

					<div class={auth.field}>
						<label class={auth.label} htmlFor="email">
							Email<span class={styles.required}>*</span>
						</label>
						<input
							id="email"
							type="email"
							class={auth.input}
							value={email}
							onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
							placeholder="you@example.com"
							autoComplete="email"
							required
						/>
						{fieldErrors.email && (
							<span class={styles.fieldError}>{fieldErrors.email}</span>
						)}
					</div>

					<div class={auth.field}>
						<label class={auth.label} htmlFor="displayName">
							Name
						</label>
						<input
							id="displayName"
							type="text"
							class={auth.input}
							value={displayName}
							onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
							placeholder="Your display name (optional)"
							autoComplete="name"
						/>
					</div>

					<div class={auth.field}>
						<label class={auth.label} htmlFor="password">
							Password<span class={styles.required}>*</span>
						</label>
						<input
							id="password"
							type="password"
							class={auth.input}
							value={password}
							onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
							placeholder="Create a password"
							autoComplete="new-password"
							required
						/>
						<span class={styles.hint}>{PASSWORD_RULE_TEXT}</span>
						{fieldErrors.password && (
							<span class={styles.fieldError}>{fieldErrors.password}</span>
						)}
					</div>

					<div class={auth.field}>
						<label class={auth.label} htmlFor="confirmPassword">
							Confirm password<span class={styles.required}>*</span>
						</label>
						<input
							id="confirmPassword"
							type="password"
							class={auth.input}
							value={confirmPassword}
							onInput={(e) =>
								setConfirmPassword((e.target as HTMLInputElement).value)
							}
							placeholder="Re-enter your password"
							autoComplete="new-password"
							required
						/>
						{fieldErrors.confirmPassword && (
							<span class={styles.fieldError}>{fieldErrors.confirmPassword}</span>
						)}
					</div>

					{registrationConfig.value.requireEmailVerification && (
						<span class={styles.hint}>
							You’ll need to verify your email address before you can sign in.
						</span>
					)}
					{registrationConfig.value.requireApproval && (
						<span class={styles.hint}>
							New accounts are reviewed by an administrator before they’re activated.
						</span>
					)}

					<Button type="submit" variant="primary" size="lg" fullWidth loading={isLoading}>
						Create account
					</Button>
				</form>

				<div class={styles.footer}>
					Already have an account?{' '}
					<a
						class={styles.link}
						href="/login"
						onClick={(e) => {
							e.preventDefault();
							goToLogin();
						}}
					>
						Sign in
					</a>
				</div>
			</div>
		</div>
	);
}

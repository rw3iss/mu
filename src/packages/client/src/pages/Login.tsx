import { useCallback, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { isAuthenticated, login } from '@/state/auth.state';
import { notifyError } from '@/state/notifications.state';
import styles from './Login.module.scss';

interface LoginProps {
	path?: string;
}

export function Login(_props: LoginProps) {
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');

	// Redirect if already authenticated
	if (isAuthenticated.value) {
		route('/', true);
		return null;
	}

	const handleSubmit = useCallback(
		async (e: Event) => {
			e.preventDefault();
			setError('');

			if (!username.trim() || !password) {
				setError('Please enter both username and password');
				return;
			}

			setIsLoading(true);

			try {
				await login(username.trim(), password);
				route('/');
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Login failed';
				setError(message);
				notifyError('Login failed. Please check your credentials.');
			} finally {
				setIsLoading(false);
			}
		},
		[username, password],
	);

	return (
		<div class={styles.page}>
			<div class={styles.card}>
				<div class={styles.header}>
					<div class={styles.logo}>M</div>
					<h1 class={styles.title}>Welcome to Mu</h1>
					<p class={styles.subtitle}>Sign in to your account</p>
				</div>

				<form class={styles.form} onSubmit={handleSubmit}>
					{error && <div class={styles.error}>{error}</div>}

					<div class={styles.field}>
						<label class={styles.label} htmlFor="username">
							Username
						</label>
						<input
							id="username"
							type="text"
							class={styles.input}
							value={username}
							onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
							placeholder="Enter your username"
							autoComplete="username"
							autoFocus
							required
						/>
					</div>

					<div class={styles.field}>
						<label class={styles.label} htmlFor="password">
							Password
						</label>
						<input
							id="password"
							type="password"
							class={styles.input}
							value={password}
							onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
							placeholder="Enter your password"
							autoComplete="current-password"
							required
						/>
					</div>

					<Button type="submit" variant="primary" size="lg" fullWidth loading={isLoading}>
						Sign In
					</Button>
				</form>
			</div>
		</div>
	);
}

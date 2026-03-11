import { useCallback, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import type { MediaPathEntryData } from '@/components/library/MediaPathList';
import { MediaPathList } from '@/components/library/MediaPathList';
import { setup } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './Setup.module.scss';

interface SetupProps {
	path?: string;
}

type Step = 'account' | 'media' | 'complete';

export function Setup(_props: SetupProps) {
	const [step, setStep] = useState<Step>('account');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');

	// Account fields
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');

	// Media source fields
	const [mediaPaths, setMediaPaths] = useState<MediaPathEntryData[]>([
		{ path: '', source: null },
	]);

	const handleAccountSubmit = useCallback(
		(e: Event) => {
			e.preventDefault();
			setError('');

			if (!username.trim() || !password) {
				setError('Username and password are required');
				return;
			}

			if (password.length < 8) {
				setError('Password must be at least 8 characters');
				return;
			}

			if (password !== confirmPassword) {
				setError('Passwords do not match');
				return;
			}

			setStep('media');
		},
		[username, password, confirmPassword],
	);

	const doSetup = useCallback(
		async (withMediaPaths?: string[]) => {
			setIsLoading(true);
			setError('');

			try {
				await setup(username.trim(), email.trim() || undefined, password, withMediaPaths);
				const count = withMediaPaths?.length ?? 0;
				notifySuccess(
					count > 0
						? `Account created and ${count} media ${count === 1 ? 'path' : 'paths'} configured`
						: 'Admin account created',
				);
				setStep('complete');
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Setup failed';
				setError(message);
				notifyError('Setup failed');
			} finally {
				setIsLoading(false);
			}
		},
		[username, email, password],
	);

	const handleMediaSubmit = useCallback(
		(e: Event) => {
			e.preventDefault();
			setError('');

			const validPaths = mediaPaths.map((entry) => entry.path.trim()).filter(Boolean);

			if (validPaths.length === 0) {
				setError('Please provide at least one media library path');
				return;
			}

			doSetup(validPaths);
		},
		[mediaPaths, doSetup],
	);

	const handleSkipMedia = useCallback(() => {
		doSetup();
	}, [doSetup]);

	const handleFinish = useCallback(() => {
		route('/');
	}, []);

	return (
		<div class={styles.page}>
			<div class={styles.card}>
				<div class={styles.header}>
					<div class={styles.logo}>M</div>
					<h1 class={styles.title}>Setup Mu</h1>
					<p class={styles.subtitle}>
						{step === 'account' && 'Create your admin account'}
						{step === 'media' && 'Configure your media library'}
						{step === 'complete' && 'Setup complete!'}
					</p>
				</div>

				{/* Progress indicator */}
				<div class={styles.progress}>
					<div
						class={`${styles.step} ${step === 'account' || step === 'media' || step === 'complete' ? styles.active : ''}`}
					>
						1
					</div>
					<div
						class={`${styles.connector} ${step === 'media' || step === 'complete' ? styles.active : ''}`}
					/>
					<div
						class={`${styles.step} ${step === 'media' || step === 'complete' ? styles.active : ''}`}
					>
						2
					</div>
					<div
						class={`${styles.connector} ${step === 'complete' ? styles.active : ''}`}
					/>
					<div class={`${styles.step} ${step === 'complete' ? styles.active : ''}`}>
						3
					</div>
				</div>

				{error && <div class={styles.error}>{error}</div>}

				{/* Step 1: Account */}
				{step === 'account' && (
					<form class={styles.form} onSubmit={handleAccountSubmit}>
						<div class={styles.field}>
							<label class={styles.label} htmlFor="setup-username">
								Username
							</label>
							<input
								id="setup-username"
								type="text"
								class={styles.input}
								value={username}
								onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
								placeholder="Choose a username"
								autoFocus
								required
							/>
						</div>

						<div class={styles.field}>
							<label class={styles.label} htmlFor="setup-email">
								Email
							</label>
							<input
								id="setup-email"
								type="email"
								class={styles.input}
								value={email}
								onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
								placeholder="your@email.com"
								required
							/>
						</div>

						<div class={styles.field}>
							<label class={styles.label} htmlFor="setup-password">
								Password
							</label>
							<input
								id="setup-password"
								type="password"
								class={styles.input}
								value={password}
								onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
								placeholder="At least 8 characters"
								minLength={8}
								required
							/>
						</div>

						<div class={styles.field}>
							<label class={styles.label} htmlFor="setup-confirm">
								Confirm Password
							</label>
							<input
								id="setup-confirm"
								type="password"
								class={styles.input}
								value={confirmPassword}
								onInput={(e) =>
									setConfirmPassword((e.target as HTMLInputElement).value)
								}
								placeholder="Repeat your password"
								required
							/>
						</div>

						<Button type="submit" variant="primary" size="lg" fullWidth>
							Next
						</Button>
					</form>
				)}

				{/* Step 2: Media Source */}
				{step === 'media' && (
					<form class={styles.form} onSubmit={handleMediaSubmit}>
						<div class={styles.field}>
							<label class={styles.label}>Media Library Paths</label>
							<MediaPathList
								entries={mediaPaths}
								onChange={setMediaPaths}
								showBrowse={false}
							/>
							<span class={styles.hint}>
								The directories where your movie files are stored
							</span>
						</div>

						<div class={styles.buttonRow}>
							<Button
								type="button"
								variant="ghost"
								size="lg"
								onClick={handleSkipMedia}
								loading={isLoading}
							>
								Skip for now
							</Button>
							<Button type="submit" variant="primary" size="lg" loading={isLoading}>
								Configure
							</Button>
						</div>
					</form>
				)}

				{/* Step 3: Complete */}
				{step === 'complete' && (
					<div class={styles.complete}>
						<div class={styles.checkmark}>{'\u2713'}</div>
						<p class={styles.completeText}>
							Everything is set up and ready to go.
							{mediaPaths.some((e) => e.path.trim())
								? ' Mu will now scan your media library for movies.'
								: ' You can add a media library later in Settings.'}
						</p>
						<Button variant="primary" size="lg" fullWidth onClick={handleFinish}>
							Start Using Mu
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

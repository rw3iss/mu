import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { setup } from '@/state/auth.state';
import { notifySuccess, notifyError } from '@/state/notifications.state';
import { api } from '@/services/api';
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
  const [mediaPath, setMediaPath] = useState('');

  const handleAccountSubmit = useCallback(
    async (e: Event) => {
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

      setIsLoading(true);

      try {
        await setup(username.trim(), email.trim() || undefined, password);
        notifySuccess('Admin account created');
        setStep('media');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Setup failed';
        setError(message);
        notifyError('Failed to create admin account');
      } finally {
        setIsLoading(false);
      }
    },
    [username, email, password, confirmPassword]
  );

  const handleMediaSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      setError('');

      if (!mediaPath.trim()) {
        setError('Please provide a media library path');
        return;
      }

      setIsLoading(true);

      try {
        await api.post('/sources', { path: mediaPath.trim() });
        notifySuccess('Media source configured');
        setStep('complete');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to configure';
        setError(message);
        notifyError('Failed to configure media source');
      } finally {
        setIsLoading(false);
      }
    },
    [mediaPath]
  );

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
          <div class={`${styles.step} ${step === 'account' || step === 'media' || step === 'complete' ? styles.active : ''}`}>
            1
          </div>
          <div class={`${styles.connector} ${step === 'media' || step === 'complete' ? styles.active : ''}`} />
          <div class={`${styles.step} ${step === 'media' || step === 'complete' ? styles.active : ''}`}>
            2
          </div>
          <div class={`${styles.connector} ${step === 'complete' ? styles.active : ''}`} />
          <div class={`${styles.step} ${step === 'complete' ? styles.active : ''}`}>
            3
          </div>
        </div>

        {error && <div class={styles.error}>{error}</div>}

        {/* Step 1: Account */}
        {step === 'account' && (
          <form class={styles.form} onSubmit={handleAccountSubmit}>
            <div class={styles.field}>
              <label class={styles.label} htmlFor="setup-username">Username</label>
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
              <label class={styles.label} htmlFor="setup-email">Email</label>
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
              <label class={styles.label} htmlFor="setup-password">Password</label>
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
              <label class={styles.label} htmlFor="setup-confirm">Confirm Password</label>
              <input
                id="setup-confirm"
                type="password"
                class={styles.input}
                value={confirmPassword}
                onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
                placeholder="Repeat your password"
                required
              />
            </div>

            <Button type="submit" variant="primary" size="lg" fullWidth loading={isLoading}>
              Create Account
            </Button>
          </form>
        )}

        {/* Step 2: Media Source */}
        {step === 'media' && (
          <form class={styles.form} onSubmit={handleMediaSubmit}>
            <div class={styles.field}>
              <label class={styles.label} htmlFor="setup-media">Media Library Path</label>
              <input
                id="setup-media"
                type="text"
                class={styles.input}
                value={mediaPath}
                onInput={(e) => setMediaPath((e.target as HTMLInputElement).value)}
                placeholder="/path/to/your/movies"
                autoFocus
                required
              />
              <span class={styles.hint}>
                The directory where your movie files are stored
              </span>
            </div>

            <div class={styles.buttonRow}>
              <Button type="button" variant="ghost" size="lg" onClick={() => handleFinish()}>
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
              Everything is set up and ready to go. Mu will now scan your media library
              for movies.
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

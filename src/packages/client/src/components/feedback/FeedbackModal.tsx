import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { feedbackService } from '@/services/feedback.service';
import { currentUser } from '@/state/auth.state';
import { notifyError } from '@/state/notifications.state';
import styles from './FeedbackModal.module.scss';

interface FeedbackModalProps {
	isOpen: boolean;
	onClose: () => void;
}

/**
 * Reusable feedback form modal. Drop it anywhere with controlled `isOpen` /
 * `onClose`, or use the app-wide instance opened via `openFeedbackModal()`.
 * Captures name, email, description, and an optional screenshot (file pick or
 * paste). The current page URL is attached automatically on submit.
 */
export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
	const user = currentUser.value;
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [description, setDescription] = useState('');
	const [screenshot, setScreenshot] = useState<File | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Reset to a clean form (prefilled from the account) each time it opens.
	useEffect(() => {
		if (!isOpen) return;
		setName(user?.username ?? '');
		setEmail(user?.email ?? '');
		setDescription('');
		setScreenshot(null);
		setPreview(null);
		setSubmitted(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- prefill only on open
	}, [isOpen]);

	// Clean up the auto-close timer on unmount.
	useEffect(() => {
		return () => {
			if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
		};
	}, []);

	// Revoke object URLs to avoid leaks.
	useEffect(() => {
		return () => {
			if (preview) URL.revokeObjectURL(preview);
		};
	}, [preview]);

	const pickFile = (file: File | null) => {
		if (preview) URL.revokeObjectURL(preview);
		if (!file) {
			setScreenshot(null);
			setPreview(null);
			return;
		}
		if (!file.type.startsWith('image/')) {
			notifyError('Please choose an image file');
			return;
		}
		setScreenshot(file);
		setPreview(URL.createObjectURL(file));
	};

	const onPaste = (e: ClipboardEvent) => {
		const imageItem = Array.from(e.clipboardData?.items ?? []).find((i) =>
			i.type.startsWith('image/'),
		);
		if (imageItem) {
			const file = imageItem.getAsFile();
			if (file) pickFile(file);
		}
	};

	const submit = async () => {
		const desc = description.trim();
		if (!desc) {
			notifyError('Please enter a description');
			return;
		}
		setSubmitting(true);
		try {
			await feedbackService.submit({
				name: name.trim() || undefined,
				email: email.trim() || undefined,
				description: desc,
				screenshot,
			});
			// Swap the form for a thank-you message, then auto-close after 2s.
			setSubmitted(true);
			closeTimerRef.current = setTimeout(() => {
				closeTimerRef.current = null;
				onClose();
			}, 2000);
		} catch (err: any) {
			notifyError(err?.message || 'Failed to submit feedback');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Send Feedback" size="md">
			{submitted ? (
				<div class={styles.success}>
					<span class={styles.successIcon}>
						<Icon name="check-circle" size={40} />
					</span>
					<p class={styles.successText}>Feedback submitted! Thanks!</p>
				</div>
			) : (
				// biome-ignore lint/a11y/noStaticElementInteractions: paste-to-attach convenience
				<div class={styles.form} onPaste={onPaste}>
					<div class={styles.field}>
						<span class={styles.label}>Name</span>
						<input
							class={styles.input}
							type="text"
							value={name}
							onInput={(e) => setName((e.target as HTMLInputElement).value)}
							placeholder="Your name"
						/>
					</div>
					<div class={styles.field}>
						<span class={styles.label}>Email (optional)</span>
						<input
							class={styles.input}
							type="email"
							value={email}
							onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
							placeholder="So we can follow up"
						/>
					</div>
					<div class={styles.field}>
						<span class={styles.label}>
							Feedback <span class={styles.req}>*</span>
						</span>
						<textarea
							class={styles.textarea}
							value={description}
							onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
							placeholder="What's working, what's broken, or an idea…"
							rows={6}
						/>
					</div>

					<div class={styles.field}>
						<span class={styles.label}>Screenshot (optional)</span>
						{preview ? (
							<div class={styles.previewWrap}>
								<img
									src={preview}
									alt="Screenshot preview"
									class={styles.preview}
								/>
								<button
									type="button"
									class={styles.removeShot}
									onClick={() => pickFile(null)}
									aria-label="Remove screenshot"
								>
									<Icon name="x" size={14} />
								</button>
							</div>
						) : (
							<label class={styles.dropzone}>
								<Icon name="image" size={18} />
								<span>Click to attach, or paste an image</span>
								<input
									type="file"
									accept="image/*"
									class={styles.fileInput}
									onChange={(e) =>
										pickFile((e.target as HTMLInputElement).files?.[0] ?? null)
									}
								/>
							</label>
						)}
					</div>

					<div class={styles.actions}>
						<Button variant="ghost" onClick={onClose} disabled={submitting}>
							Cancel
						</Button>
						<Button variant="primary" onClick={submit} loading={submitting}>
							Send Feedback
						</Button>
					</div>
				</div>
			)}
		</Modal>
	);
}

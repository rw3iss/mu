import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { shareLinksService } from '@/services/share-links.service';

interface ShareMovieModalProps {
	movieId: string;
	movieTitle?: string;
	isOpen: boolean;
	onClose: () => void;
}

export function ShareMovieModal({ movieId, movieTitle, isOpen, onClose }: ShareMovieModalProps) {
	const [url, setUrl] = useState<string | null>(null);
	const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!isOpen) {
			setUrl(null);
			setError(null);
			setCopied(false);
			return;
		}
		setLoading(true);
		shareLinksService
			.create(movieId)
			.then((result) => {
				setUrl(shareLinksService.buildUrl(result.token));
				setExpiresInDays(result.expiresInDays);
				setLoading(false);
			})
			.catch((err) => {
				setError(err?.body?.message || err?.message || 'Failed to create share link');
				setLoading(false);
			});
	}, [isOpen, movieId]);

	const handleCopy = () => {
		if (!url) return;
		try {
			navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback: select the textarea
			textareaRef.current?.select();
			document.execCommand?.('copy');
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Share this movie" size="md">
			<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
				<p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
					Anyone with this link can watch
					{movieTitle ? ` "${movieTitle}"` : ' this movie'} — no account required.
					{expiresInDays != null
						? ` The link expires in ${expiresInDays} day${expiresInDays === 1 ? '' : 's'}.`
						: ' The link does not expire.'}
				</p>

				{loading && (
					<div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
						<Spinner size="md" />
					</div>
				)}

				{error && (
					<div
						style={{
							color: 'var(--color-error, #e66)',
							fontSize: 14,
							padding: 12,
							background: 'rgba(230, 102, 102, 0.1)',
							borderRadius: 6,
						}}
					>
						{error}
					</div>
				)}

				{url && !loading && (
					<>
						<textarea
							ref={textareaRef}
							readOnly
							value={url}
							onClick={(e: Event) =>
								(e.currentTarget as HTMLTextAreaElement).select()
							}
							style={{
								width: '100%',
								minHeight: 60,
								padding: 10,
								fontFamily: 'monospace',
								fontSize: 13,
								background: 'var(--color-bg-secondary, #222)',
								color: 'var(--color-text, #fff)',
								border: '1px solid var(--color-border, #444)',
								borderRadius: 6,
								resize: 'none',
								boxSizing: 'border-box',
							}}
						/>
						<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
							<Button variant="ghost" onClick={onClose}>
								Close
							</Button>
							<Button variant="primary" onClick={handleCopy}>
								{copied ? (
									<>
										<Icon name="check" size={14} /> Copied!
									</>
								) : (
									'Copy link'
								)}
							</Button>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

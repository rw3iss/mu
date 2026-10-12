import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { musicShareService } from '@/services/music.service';
import { closeMusicShare, musicShareTarget } from '@/state/musicShare.state';
import { copyToClipboard } from '@/utils/clipboard';

const NOUN = { track: 'track', album: 'album', playlist: 'playlist', queue: 'queue' } as const;

/**
 * Global "share music" dialog (mounted once at the app root; opened with
 * `openMusicShare`). Creates a public `/listen/<token>` link anyone can play
 * without an account, until it expires or is revoked.
 */
export function MusicShareModal() {
	const target = musicShareTarget.value;
	const [url, setUrl] = useState<string | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [expiresAt, setExpiresAt] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		setUrl(null);
		setToken(null);
		setError(null);
		setCopied(false);
		if (!target) return;
		let cancelled = false;
		musicShareService
			.create({ kind: target.kind, id: target.id, trackIds: target.trackIds })
			.then((info) => {
				if (cancelled) return;
				setUrl(musicShareService.url(info));
				setToken(info.token);
				setExpiresAt(info.expiresAt);
			})
			.catch((err) => {
				if (!cancelled) setError(err?.message || 'Could not create the share link');
			});
		return () => {
			cancelled = true;
		};
	}, [target]);

	if (!target) return null;
	const noun = NOUN[target.kind];

	const copy = () => {
		if (!url) return;
		void copyToClipboard(url).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	const revoke = async () => {
		if (!token) return;
		await musicShareService.revoke(token).catch(() => {});
		closeMusicShare();
	};

	return (
		<Modal isOpen onClose={closeMusicShare} title={`Share this ${noun}`} size="md">
			<div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
				<p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
					Anyone with this link can listen to
					{target.title ? ` “${target.title}”` : ` this ${noun}`} in the Mu player — no
					account needed.
					{target.kind === 'queue'
						? ' The link plays the queue as it is now.'
						: target.kind === 'playlist'
							? ' Changes to the playlist show up in the link.'
							: ''}
					{expiresAt
						? ` It expires on ${new Date(expiresAt).toLocaleDateString()}.`
						: url
							? ' It does not expire.'
							: ''}
				</p>
				{!url && !error && (
					<div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
						<Spinner size="md" />
					</div>
				)}
				{error && (
					<p style={{ margin: 0, color: 'var(--color-error, #e66)', fontSize: 14 }}>
						{error}
					</p>
				)}
				{url && (
					<>
						<input
							readOnly
							value={url}
							onFocus={(e) => (e.target as HTMLInputElement).select()}
							style={{
								width: '100%',
								padding: 'var(--space-sm)',
								fontFamily: 'monospace',
								fontSize: 13,
								background: 'var(--color-input-bg)',
								color: 'var(--color-input-text)',
								border: '1px solid var(--color-border)',
								borderRadius: 'var(--radius-sm)',
								boxSizing: 'border-box',
							}}
						/>
						<div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
							<Button variant="ghost" onClick={revoke} title="Delete this link">
								Revoke link
							</Button>
							<div style={{ display: 'flex', gap: 8 }}>
								<Button variant="ghost" onClick={closeMusicShare}>
									Close
								</Button>
								<Button variant="primary" onClick={copy}>
									{copied ? (
										<>
											<Icon name="check" size={14} /> Copied!
										</>
									) : (
										'Copy link'
									)}
								</Button>
							</div>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

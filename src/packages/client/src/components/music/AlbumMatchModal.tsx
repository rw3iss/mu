import type { AlbumMatchState, MusicMatchCandidate } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { musicService } from '@/services/music.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './AlbumMatchModal.module.scss';

interface AlbumMatchModalProps {
	isOpen: boolean;
	onClose: () => void;
	albumId: string;
	albumTitle: string;
	artistCredit: string | null;
	/** Called after a match is applied (the page reloads the album). */
	onMatched: () => void;
}

/**
 * Pick the MusicBrainz release for an album. Shows stored candidates first;
 * "Search" runs a live lookup with editable title/artist. Applying a match
 * queues a metadata job (genres, art, artist info).
 */
export function AlbumMatchModal({
	isOpen,
	onClose,
	albumId,
	albumTitle,
	artistCredit,
	onMatched,
}: AlbumMatchModalProps) {
	const [state, setState] = useState<AlbumMatchState | null>(null);
	const [loading, setLoading] = useState(false);
	const [applying, setApplying] = useState<string | null>(null);
	const [title, setTitle] = useState(albumTitle);
	const [artist, setArtist] = useState(artistCredit ?? '');

	const load = async (refresh: boolean) => {
		setLoading(true);
		try {
			setState(
				await musicService.matchCandidates(
					albumId,
					refresh ? { refresh, title, artist } : {},
				),
			);
		} catch (err) {
			notifyError((err as Error)?.message || 'MusicBrainz lookup failed');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (!isOpen) return;
		setTitle(albumTitle);
		setArtist(artistCredit ?? '');
		void load(false);
	}, [isOpen, albumId]);

	const apply = async (c: MusicMatchCandidate) => {
		setApplying(c.releaseMbid);
		try {
			setState(await musicService.matchAlbum(albumId, { releaseMbid: c.releaseMbid }));
			notifySuccess('Match applied — fetching metadata in the background');
			onMatched();
			onClose();
		} catch (err) {
			notifyError((err as Error)?.message || 'Failed to apply match');
		} finally {
			setApplying(null);
		}
	};

	const candidates = state?.candidates ?? [];

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Match album on MusicBrainz" size="lg">
			<form
				class={styles.search}
				onSubmit={(e) => {
					e.preventDefault();
					void load(true);
				}}
			>
				<input
					class={styles.input}
					value={title}
					placeholder="Album title"
					onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
				/>
				<input
					class={styles.input}
					value={artist}
					placeholder="Artist"
					onInput={(e) => setArtist((e.target as HTMLInputElement).value)}
				/>
				<Button type="submit" variant="secondary" loading={loading}>
					Search
				</Button>
			</form>

			{state?.status === 'matched' && (
				<p class={styles.note}>
					Matched to release group <code>{state.releaseGroupMbid}</code>. Pick another
					release to change it.
				</p>
			)}

			{loading && !state ? (
				<div class={styles.center}>
					<Spinner />
				</div>
			) : candidates.length === 0 ? (
				<p class={styles.note}>
					{state?.status === 'unsearched'
						? 'Not searched yet — press Search.'
						: 'No candidates. Try a different title or artist.'}
				</p>
			) : (
				<ul class={styles.list}>
					{candidates.map((c) => (
						<li key={c.releaseMbid} class={styles.row}>
							<div class={styles.info}>
								<span class={styles.title}>
									{c.title}
									{c.artistCredit ? ` — ${c.artistCredit}` : ''}
								</span>
								<span class={styles.meta}>
									{[
										c.year,
										c.primaryType,
										...c.secondaryTypes,
										c.trackCount != null ? `${c.trackCount} tracks` : null,
										c.format,
										c.country,
										c.status,
									]
										.filter(Boolean)
										.join(' · ')}
								</span>
							</div>
							<span class={styles.score} title="Match score">
								{Math.round(c.score * 100)}%
							</span>
							<a
								class={styles.link}
								href={`https://musicbrainz.org/release/${c.releaseMbid}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								View
							</a>
							<Button
								size="sm"
								loading={applying === c.releaseMbid}
								disabled={applying !== null}
								onClick={() => apply(c)}
							>
								Use
							</Button>
						</li>
					))}
				</ul>
			)}
		</Modal>
	);
}

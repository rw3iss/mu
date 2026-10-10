import type { AlbumDetail, AlbumSummary } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { musicService } from '@/services/music.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { formatDuration } from '@/utils/music';
import styles from './AlbumMatchModal.module.scss';

interface AlbumEditModalProps {
	mode: 'merge' | 'split' | null;
	onClose: () => void;
	album: AlbumDetail;
}

/**
 * Fix album grouping: merge this album into another one (tracks, ratings and
 * favourites move; future scans of this folder follow), or split chosen
 * tracks off into a new album.
 */
export function AlbumEditModal({ mode, onClose, album }: AlbumEditModalProps) {
	const [q, setQ] = useState(album.title);
	const [results, setResults] = useState<AlbumSummary[]>([]);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [title, setTitle] = useState(`${album.title} (Disc 2)`);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (mode !== 'merge') return;
		const handle = setTimeout(() => {
			musicService
				.albums({ q: q.trim() || undefined, pageSize: 20, sort: 'title' })
				.then((p) => setResults(p.items.filter((a) => a.id !== album.id)))
				.catch(() => setResults([]));
		}, 200);
		return () => clearTimeout(handle);
	}, [mode, q, album.id]);

	useEffect(() => {
		setPicked(new Set());
		setQ(album.title);
		setTitle(`${album.title} (Disc 2)`);
	}, [mode, album.id]);

	const merge = async (target: AlbumSummary) => {
		setBusy(true);
		try {
			const r = await musicService.mergeAlbum(album.id, target.id);
			notifySuccess(
				`Merged ${r.movedTracks} track${r.movedTracks === 1 ? '' : 's'} into “${target.title}”`,
			);
			onClose();
			route(`/album/${r.albumId}`);
		} catch (err) {
			notifyError((err as Error)?.message || 'Merge failed');
		} finally {
			setBusy(false);
		}
	};

	const split = async () => {
		setBusy(true);
		try {
			const r = await musicService.splitAlbum(album.id, [...picked], title);
			notifySuccess(
				`Moved ${r.movedTracks} track${r.movedTracks === 1 ? '' : 's'} to “${title}”`,
			);
			onClose();
			route(`/album/${r.albumId}`);
		} catch (err) {
			notifyError((err as Error)?.message || 'Split failed');
		} finally {
			setBusy(false);
		}
	};

	const toggle = (id: string) =>
		setPicked((s) => {
			const next = new Set(s);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<Modal
			isOpen={mode !== null}
			onClose={onClose}
			title={mode === 'merge' ? `Merge “${album.title}” into…` : `Split “${album.title}”`}
			size="lg"
		>
			{mode === 'merge' ? (
				<>
					<p class={styles.note}>
						Every track, rating, comment and favourite of this album moves to the album
						you pick, and this album is removed. New files in its folder join the picked
						album.
					</p>
					<div class={styles.search}>
						<input
							class={styles.input}
							value={q}
							placeholder="Search albums"
							onInput={(e) => setQ((e.target as HTMLInputElement).value)}
						/>
					</div>
					<ul class={styles.list}>
						{results.map((a) => (
							<li key={a.id} class={styles.row}>
								<div class={styles.info}>
									<span class={styles.title}>
										{a.title}
										{a.artistCredit ? ` — ${a.artistCredit}` : ''}
									</span>
									<span class={styles.meta}>
										{[a.year, `${a.trackCount} tracks`]
											.filter(Boolean)
											.join(' · ')}
									</span>
								</div>
								<Button size="sm" disabled={busy} onClick={() => merge(a)}>
									Merge here
								</Button>
							</li>
						))}
					</ul>
				</>
			) : (
				<>
					<p class={styles.note}>Pick the tracks to move into a new album.</p>
					<div class={styles.search}>
						<input
							class={styles.input}
							value={title}
							placeholder="New album title"
							onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
						/>
						<Button
							disabled={
								busy ||
								picked.size === 0 ||
								picked.size === album.tracks.length ||
								!title.trim()
							}
							loading={busy}
							onClick={split}
						>
							Split {picked.size || ''}
						</Button>
					</div>
					<ul class={styles.list}>
						{album.tracks.map((t) => (
							<li key={t.id} class={styles.row}>
								<input
									type="checkbox"
									checked={picked.has(t.id)}
									onChange={() => toggle(t.id)}
									aria-label={`Move ${t.title}`}
								/>
								<div class={styles.info}>
									<span class={styles.title}>
										{t.discNo > 1 ? `${t.discNo}-` : ''}
										{t.trackNo ?? '–'}. {t.title}
									</span>
								</div>
								<span class={styles.meta}>{formatDuration(t.durationSeconds)}</span>
							</li>
						))}
					</ul>
				</>
			)}
		</Modal>
	);
}

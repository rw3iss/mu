import { Icon } from '@/components/common/Icon';
import { SubtitleAppearance } from '@/components/movie/SubtitleAppearance';
import { SubtitlePanel } from '@/components/movie/SubtitlePanel';
import { useUiSetting } from '@/hooks/useUiSetting';
import { globalMovie, globalMovieId } from '@/state/globalPlayer.state';
import {
	currentSession,
	refreshSessionSubtitles,
	saveSubtitleChoice,
	subtitleTrack,
} from '@/state/player.state';
import styles from '../../PlayerControls.module.scss';
import type { SettingsMenuApi } from './types';

function SubtitleSettingsCollapsible() {
	const [open, setOpen] = useUiSetting('subtitle_settings_panel_open', false);
	return (
		<div>
			<button
				class={styles.menuItem}
				onClick={() => setOpen(!open)}
				style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
			>
				<span>Settings</span>
				<span style={{ display: 'inline-flex', color: 'rgba(255,255,255,0.5)' }}>
					<Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
				</span>
			</button>
			{open && (
				<div style={{ padding: '8px 12px' }}>
					<SubtitleAppearance compact />
				</div>
			)}
		</div>
	);
}

export function SubtitleManagePanel({ session, openPanel }: SettingsMenuApi) {
	return (
		<>
			<button class={styles.menuBack} onClick={() => openPanel('subtitles')}>
				<Icon name="chevron-left" size={14} /> Manage Subtitles
			</button>
			<div class={styles.menuPanelContent}>
				<SubtitleSettingsCollapsible />
				<div class={styles.menuDivider} />
				{globalMovieId.value && (
					<SubtitlePanel
						movieId={globalMovieId.value}
						fileName={
							globalMovie.value?.fileInfo?.fileName ||
							globalMovie.value?.fileInfo?.filePath?.split(/[/\\]/).pop() ||
							undefined
						}
						existingTracks={(session?.subtitles ?? []).map((t, i) => ({
							index: i,
							language: t.language,
							label: t.label,
						}))}
						activeLabel={
							(session?.subtitles ?? []).find((t) => t.id === subtitleTrack.value)
								?.label
						}
						activeLanguage={
							(session?.subtitles ?? []).find((t) => t.id === subtitleTrack.value)
								?.language
						}
						onTrackDeleted={(track) => {
							const s = currentSession.value;
							if (!s) return;
							const activeId = subtitleTrack.value;
							if (activeId) {
								const activeSub = s.subtitles.find((st) => st.id === activeId);
								if (
									activeSub &&
									activeSub.label === track.label &&
									activeSub.language === track.language
								) {
									subtitleTrack.value = null;
									const mid = globalMovieId.value;
									if (mid) saveSubtitleChoice(mid, null);
								}
							}
						}}
						onSubtitlesChanged={async () => {
							const mid = globalMovieId.value;
							if (!mid) return;
							try {
								// Authoritative rebuild —
								// ids/URLs come from the
								// server's track index, not
								// array position.
								await refreshSessionSubtitles(mid);
							} catch {}
						}}
						onSelect={(track) => {
							// Select this subtitle track for playback
							const s = currentSession.value;
							if (!s) return;
							const sub =
								s.subtitles.find(
									(st) =>
										st.label === track.label && st.language === track.language,
								) ?? s.subtitles[track.index];
							if (sub) {
								const movieId = globalMovieId.value;
								if (movieId) {
									saveSubtitleChoice(movieId, sub.id);
								} else {
									subtitleTrack.value = sub.id;
								}
							}
						}}
						onTrackAdded={async (track) => {
							const movieId = globalMovieId.value;
							if (!movieId) return;
							// Re-read the whole list rather
							// than appending a guess: a new
							// sidecar makes the server
							// re-index every track, so the
							// download's own index can point
							// at a different file by the
							// time we use it.
							const tracks = await refreshSessionSubtitles(movieId).catch(() => []);
							const match =
								tracks.find((t) => t.id === String(track.index)) ??
								tracks.find(
									(t) => t.label === track.label && t.language === track.language,
								);
							// Auto-select the download.
							if (match) {
								saveSubtitleChoice(movieId, match.id);
							}
						}}
					/>
				)}
			</div>
		</>
	);
}

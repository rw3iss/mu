import { Icon } from '@/components/common/Icon';
import { useUiSetting } from '@/hooks/useUiSetting';
import { sharedSessionService } from '@/services/shared-session.service';
import { globalMovie, globalMovieId } from '@/state/globalPlayer.state';
import { notifyError } from '@/state/notifications.state';
import { audioTrack, quality, subtitleTrack } from '@/state/player.state';
import { activeSession } from '@/state/shared-session.state';
import { isRecordingSnippet, snippetSupported, startSnippet } from '@/state/snippet-recorder.state';
import styles from '../../PlayerControls.module.scss';
import { openInviteModal } from '../../session/session-ui.state';
import type { SettingsMenuApi } from './types';

/** Root settings rows. Each renders one `menuRow` button (or nothing). */

export function QualityItem({ openPanel }: SettingsMenuApi) {
	return (
		<button class={styles.menuRow} onClick={() => openPanel('quality')}>
			<span class={styles.menuRowLabel}>Quality</span>
			<span class={styles.menuRowValue}>
				{quality.value === 'auto' ? 'Auto' : quality.value}
			</span>
			<span class={styles.menuRowChevron}>
				<Icon name="chevron-right" size={14} />
			</span>
		</button>
	);
}

export function SubtitlesItem({ session, openPanel }: SettingsMenuApi) {
	return (
		<button class={styles.menuRow} onClick={() => openPanel('subtitles')}>
			<span class={styles.menuRowLabel}>Subtitles</span>
			<span class={styles.menuRowValue}>
				{subtitleTrack.value
					? (session?.subtitles?.find((t) => t.id === subtitleTrack.value)?.label ?? 'On')
					: 'Off'}
			</span>
			<span class={styles.menuRowChevron}>
				<Icon name="chevron-right" size={14} />
			</span>
		</button>
	);
}

export function CommentBubblesItem(_: SettingsMenuApi) {
	const [showCommentBubbles, setShowCommentBubbles] = useUiSetting(
		'player_show_comment_bubbles',
		false,
	);
	return (
		<button class={styles.menuRow} onClick={() => setShowCommentBubbles(!showCommentBubbles)}>
			<span class={styles.menuRowLabel}>
				{showCommentBubbles ? 'Hide Comments' : 'Show Comments'}
			</span>
			<span class={styles.menuRowValue}>{showCommentBubbles ? 'On' : 'Off'}</span>
		</button>
	);
}

export function RecordSnippetItem({ close }: SettingsMenuApi) {
	if (!snippetSupported()) return null;
	return (
		<button
			class={styles.menuRow}
			disabled={isRecordingSnippet.value}
			onClick={() => {
				startSnippet(globalMovie.value?.title);
				close();
			}}
		>
			<span class={styles.menuRowLabel}>Record Snippet</span>
			<span class={styles.menuRowValue}>{isRecordingSnippet.value ? 'Recording…' : ''}</span>
		</button>
	);
}

export function StartSharedSessionItem({ close }: SettingsMenuApi) {
	if (!globalMovieId.value || activeSession.value) return null;
	return (
		<button
			class={styles.menuRow}
			onClick={() => {
				close();
				void sharedSessionService
					.startSession(globalMovieId.value!)
					.then(() => openInviteModal())
					.catch(() => notifyError('Failed to start shared session.'));
			}}
		>
			<span class={styles.menuRowLabel}>Start Shared Session</span>
		</button>
	);
}

export function AudioTrackItem({ session, openPanel }: SettingsMenuApi) {
	if ((session?.audioTracks?.length ?? 0) <= 1) return null;
	return (
		<button class={styles.menuRow} onClick={() => openPanel('audio')}>
			<span class={styles.menuRowLabel}>Audio Track</span>
			<span class={styles.menuRowValue}>
				{audioTrack.value
					? (session?.audioTracks?.find((t) => String(t.id) === audioTrack.value)
							?.label ??
						session?.audioTracks
							?.find((t) => String(t.id) === audioTrack.value)
							?.language?.toUpperCase() ??
						`Track ${audioTrack.value}`)
					: (session?.audioTracks?.[0]?.label ??
						session?.audioTracks?.[0]?.language?.toUpperCase() ??
						'Default')}
			</span>
			<span class={styles.menuRowChevron}>
				<Icon name="chevron-right" size={14} />
			</span>
		</button>
	);
}

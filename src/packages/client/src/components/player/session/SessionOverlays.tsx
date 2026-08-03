import { SessionChatWindow } from './SessionChatWindow';
import { SessionSettingsPanel } from './SessionSettingsPanel';
import { SpeakingIndicator } from './SpeakingIndicator';
import { VoiceAudioPanel } from './VoiceAudioPanel';

/**
 * In-player Shared Sessions overlays: the slide-in panels, chat window and
 * speaking indicator. Each child self-gates on its own signal, so this is
 * inert when there's no active session / open panel. Rendered by GlobalPlayer;
 * all children are fixed/portal-positioned so tree location is irrelevant to
 * both full and split player modes.
 *
 * The lifecycle MODALS (invite / accept / leave / end) live in
 * {@link SessionModals}, mounted at the app root so they can appear even when
 * the player is idle (e.g. an invite arriving while browsing the library).
 */
export function SessionOverlays() {
	return (
		<>
			<SessionSettingsPanel />
			<VoiceAudioPanel />
			<SessionChatWindow />
			<SpeakingIndicator />
		</>
	);
}

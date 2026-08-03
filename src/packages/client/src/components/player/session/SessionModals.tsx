import { AcceptInviteModal } from './AcceptInviteModal';
import { EndSessionModal } from './EndSessionModal';
import { InviteMembersModal } from './InviteMembersModal';
import { LeaveSessionModal } from './LeaveSessionModal';

/**
 * Shared Sessions lifecycle modals, mounted at the app root so they render
 * independently of the player overlay (which unmounts when idle). Each modal
 * self-gates on its own signal / `pendingInvite`, so this is inert until one
 * is opened.
 */
export function SessionModals() {
	return (
		<>
			<InviteMembersModal />
			<AcceptInviteModal />
			<LeaveSessionModal />
			<EndSessionModal />
		</>
	);
}

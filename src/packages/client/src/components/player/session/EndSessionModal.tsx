import { useState } from 'preact/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { sharedSessionService } from '@/services/shared-session.service';
import { notifyError } from '@/state/notifications.state';
import { closeEndModal, showEndModal } from './session-ui.state';

/** Admin confirm to end the session for everyone. */
export function EndSessionModal() {
	const [ending, setEnding] = useState(false);

	const end = async () => {
		setEnding(true);
		try {
			await sharedSessionService.endSession();
			closeEndModal();
		} catch {
			notifyError('Failed to end the session.');
		} finally {
			setEnding(false);
		}
	};

	return (
		<ConfirmDialog
			isOpen={showEndModal.value}
			onClose={closeEndModal}
			onConfirm={end}
			title="End Shared Session?"
			message="This ends the session for everyone. Each member's movie keeps playing on its own."
			confirmLabel="End Session"
			variant="danger"
			loading={ending}
		/>
	);
}

import { signal } from '@preact/signals';

/**
 * UI-only open/close state for the Shared Sessions modals. Kept out of the
 * core `shared-session.state.ts` (which the service owns) so the UI layer can
 * drive the invite / leave / end dialogs without touching session logic.
 */

export const showInviteModal = signal(false);
export const showLeaveModal = signal(false);
export const showEndModal = signal(false);

export function openInviteModal(): void {
	showInviteModal.value = true;
}
export function closeInviteModal(): void {
	showInviteModal.value = false;
}
export function openLeaveModal(): void {
	showLeaveModal.value = true;
}
export function closeLeaveModal(): void {
	showLeaveModal.value = false;
}
export function openEndModal(): void {
	showEndModal.value = true;
}
export function closeEndModal(): void {
	showEndModal.value = false;
}

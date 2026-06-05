import { signal } from '@preact/signals';

/**
 * Controls the global Feedback modal, mounted once in AppShell so any component
 * (the sidebar entry, a "report a problem" link, etc.) can open it via
 * `openFeedbackModal()`.
 */
export const feedbackModalOpen = signal(false);

export function openFeedbackModal(): void {
	feedbackModalOpen.value = true;
}

export function closeFeedbackModal(): void {
	feedbackModalOpen.value = false;
}

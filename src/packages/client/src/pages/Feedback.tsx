import { FeedbackAdmin } from '@/components/admin/FeedbackAdmin';
import { isAdmin } from '@/state/auth.state';
import styles from './Feedback.module.scss';

interface FeedbackPageProps {
	path?: string;
}

/** Admin-only feedback manager page (route: /feedback). */
export function Feedback(_props: FeedbackPageProps) {
	if (!isAdmin.value) {
		return (
			<div class={styles.denied}>
				<h2>Not authorized</h2>
				<p>The feedback manager is available to administrators only.</p>
			</div>
		);
	}

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<h1 class={styles.title}>Feedback</h1>
				<p class={styles.subtitle}>Review and manage feedback submitted by users.</p>
			</header>
			<FeedbackAdmin />
		</div>
	);
}

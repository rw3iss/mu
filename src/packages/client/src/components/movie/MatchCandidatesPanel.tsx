import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import type { MatchCandidate } from '@/services/movies.service';
import styles from './MatchCandidatesPanel.module.scss';

interface MatchCandidatesPanelProps {
	candidates: MatchCandidate[];
	/** Called with the candidate the user picked. Should resolve once
	 *  the server has applied it (so the panel can clear). */
	onApply: (candidate: MatchCandidate) => Promise<void>;
	/** Called when the user dismisses all candidates without picking. */
	onDismiss: () => Promise<void> | void;
	/** Heading shown above the list. Defaults to a generic prompt. */
	heading?: string;
	/** Label on the per-row "apply" button. Defaults to "This one". */
	applyLabel?: string;
	/** Label on the bulk dismiss button. Defaults to "None of these". */
	dismissLabel?: string;
	/** Override how the confidence number is rendered. Defaults to a
	 *  rounded percentage. */
	confidenceFormatter?: (value: number) => string;
	/** Pass-through class merged onto the outer panel — keeps the
	 *  component composable with surrounding layout containers. */
	class?: string;
	style?: JSX.CSSProperties;
}

const defaultConfidence = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Surfaced when the auto-matcher couldn't pick a winner — shows the
 * persisted candidate rows and lets the user commit one. Reused by
 * the movie detail page, group detail page, and any future
 * "needs review" surfaces.
 *
 * Renders nothing when the candidate list is empty, so consumers can
 * include it unconditionally and let the panel manage its own
 * visibility.
 */
export function MatchCandidatesPanel({
	candidates,
	onApply,
	onDismiss,
	heading = "We weren't sure which one this is — pick a match:",
	applyLabel = 'This one',
	dismissLabel = 'None of these',
	confidenceFormatter = defaultConfidence,
	class: className,
	style,
}: MatchCandidatesPanelProps) {
	const [applyingId, setApplyingId] = useState<string | null>(null);
	const [dismissing, setDismissing] = useState(false);

	if (!candidates || candidates.length === 0) return null;

	async function handleApply(c: MatchCandidate) {
		setApplyingId(c.id);
		try {
			await onApply(c);
		} finally {
			setApplyingId(null);
		}
	}

	async function handleDismiss() {
		setDismissing(true);
		try {
			await onDismiss();
		} finally {
			setDismissing(false);
		}
	}

	const panelClass = className ? `${styles.panel} ${className}` : styles.panel;

	return (
		<div class={panelClass} style={style} role="region" aria-label="Match candidates">
			<div class={styles.header}>
				<h3 class={styles.heading}>{heading}</h3>
				<span class={styles.hint}>
					{candidates.length} candidate{candidates.length === 1 ? '' : 's'}
				</span>
			</div>

			<ul class={styles.list}>
				{candidates.map((c) => (
					<li key={c.id} class={styles.row}>
						{c.posterUrl ? (
							<img class={styles.poster} src={c.posterUrl} alt="" loading="lazy" />
						) : (
							<div class={styles.posterPlaceholder} aria-hidden="true">
								No art
							</div>
						)}

						<div class={styles.info}>
							<div class={styles.title}>
								{c.title}
								{c.isBest && <span class={styles.bestBadge}>Best</span>}
							</div>
							<div class={styles.meta}>
								{c.year && <span>{c.year}</span>}
								{c.runtimeMinutes && <span>{c.runtimeMinutes} min</span>}
								<span>{c.provider}</span>
								<span class={styles.confidence}>
									{confidenceFormatter(c.confidence)}
								</span>
							</div>
							{c.overview && <p class={styles.overview}>{c.overview}</p>}
						</div>

						<Button
							variant={c.isBest ? 'primary' : 'secondary'}
							size="sm"
							onClick={() => handleApply(c)}
							disabled={applyingId !== null}
							loading={applyingId === c.id}
						>
							{applyingId === c.id ? 'Applying…' : applyLabel}
						</Button>
					</li>
				))}
			</ul>

			<div class={styles.footer}>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleDismiss}
					disabled={dismissing}
				>
					{dismissing ? 'Dismissing…' : dismissLabel}
				</Button>
			</div>
		</div>
	);
}

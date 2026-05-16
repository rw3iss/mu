import { useEffect, useState } from 'preact/hooks';
import { Select } from '@/components/common/Select';
import { settingsService } from '@/services/settings.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './Matching.module.scss';

const RETENTION_KEY = 'matching.externalEvictionDays';
const RETENTION_OPTIONS: { label: string; value: number }[] = [
	{ label: '5 days', value: 5 },
	{ label: '15 days', value: 15 },
	{ label: '30 days', value: 30 },
	{ label: '60 days (recommended)', value: 60 },
	{ label: '120 days', value: 120 },
	{ label: 'Never (keep forever)', value: -1 },
];
const DEFAULT_RETENTION = 60;

/**
 * Admin Matching panel. Currently exposes the external-cache eviction
 * window; future controls (strategy weights, MMR λ, quality floor,
 * LLM budget) land here as they ship.
 */
export function Matching() {
	const [retention, setRetention] = useState<number>(DEFAULT_RETENTION);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		settingsService
			.get(RETENTION_KEY)
			.then((value) => {
				if (typeof value === 'number') {
					setRetention(value);
				} else if (typeof value === 'string') {
					if (value === 'never') setRetention(-1);
					else {
						const n = parseInt(value, 10);
						if (!Number.isNaN(n)) setRetention(n);
					}
				}
			})
			.catch(() => {})
			.finally(() => setLoaded(true));
	}, []);

	const update = async (value: number) => {
		setRetention(value);
		setSaving(true);
		try {
			await settingsService.set(RETENTION_KEY, value);
			notifySuccess('Eviction window updated');
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to save');
		} finally {
			setSaving(false);
		}
	};

	return (
		<div class={styles.wrap}>
			<div class={styles.intro}>
				<h2 class={styles.heading}>Matching</h2>
				<p class={styles.lede}>
					Tune how Mu finds similar movies. Defaults work well — change these
					if you want more adventurous results, longer cache retention, or
					tighter spend on paid providers.
				</p>
			</div>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>External cache retention</h3>
					<p class={styles.sectionLede}>
						When Discover surfaces movies you don't own, Mu caches them
						(metadata + embeddings) so subsequent ranking is fast. Untouched
						entries beyond this window are evicted automatically.
					</p>
				</div>
				<div class={styles.controlRow}>
					<label class={styles.controlLabel} for="retention-select">
						Keep external candidates for
					</label>
					<Select<number>
						id="retention-select"
						value={retention}
						disabled={!loaded || saving}
						options={RETENTION_OPTIONS}
						onChange={(v) => update(v)}
					/>
				</div>
			</section>

			<div class={styles.placeholder}>
				More tuning controls coming:
				<ul>
					<li>Strategy weight sliders (TMDB / Trakt / content-vector / embedding / LLM rerank)</li>
					<li>Diversity (MMR λ) and quality floor</li>
					<li>Exclusion filters (same-group, already-watched, per-director cap)</li>
					<li>Multi-input policy (centroid / union-of-neighbours / auto)</li>
					<li>LLM monthly budget ceiling (USD)</li>
					<li>Auto-enrichment toggles for library scans</li>
				</ul>
			</div>
		</div>
	);
}

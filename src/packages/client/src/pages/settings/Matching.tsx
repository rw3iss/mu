import styles from './Matching.module.scss';

/**
 * Admin "Matching" panel — tuning controls for the recommendation
 * pipeline (strategy weights, MMR diversity λ, quality floor,
 * exclusions, LLM budget, auto-enrichment toggles).
 *
 * Phase 0 ships the layout + lede only; the actual controls land in
 * Phase 1 (strategy weights) and Phase 5 (LLM budget). All settings
 * persist to the existing `settings` table via `SettingsService`.
 */
export function Matching() {
	return (
		<div class={styles.wrap}>
			<div class={styles.intro}>
				<h2 class={styles.heading}>Matching</h2>
				<p class={styles.lede}>
					Tune how Mu finds similar movies. Adjust strategy weights, diversity,
					quality thresholds, exclusions, and AI re-rank behaviour. Defaults
					work well — change these if you want more adventurous results, or to
					constrain cost on paid providers.
				</p>
			</div>
			<div class={styles.placeholder}>
				Tuning controls land alongside the recommendation strategies. Available
				once Phase 1 (TMDB + content vectors) ships:
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

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Select } from '@/components/common/Select';
import { api } from '@/services/api';
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

interface MatchingConfig {
	strategyWeights: Record<string, number>;
	mmrLambda: number;
	qualityFloor: number;
	excludeSameGroup: boolean;
	excludeWatched: boolean;
	perDirectorCap: number;
	multiInputPolicy: 'centroid' | 'union' | 'auto';
	autoEnrichExternalRecs: boolean;
	autoEnrichEmbeddings: boolean;
	autoEnrichLlmFeatures: boolean;
}

interface ImdbDatasetStatus {
	id: string;
	displayName: string;
	approxSizeMb: number;
	rowCount: number;
	lastSyncAt: string | null;
	lastSyncDurationMs: number | null;
	lastError: string | null;
	running: boolean;
}
interface ImdbDatasetsState {
	enabled: boolean;
	datasets: ImdbDatasetStatus[];
}

const STRATEGY_LABELS: Record<string, string> = {
	'content-vector': 'Content vector (cast / genres / keywords overlap)',
	'external-cache': 'TMDB + Trakt similar movies',
	embedding: 'Plot embedding (semantic similarity)',
	'llm-rerank': 'LLM rerank (Anthropic-powered)',
};

const STRATEGY_ORDER = ['content-vector', 'external-cache', 'embedding', 'llm-rerank'] as const;

/**
 * Admin Matching panel. Exposes the recommendation pipeline's tuning
 * knobs as one cohesive form — each control writes through to the
 * generic /settings/:key store. The orchestrator (recommendations
 * service) reads these on every call via `withSettings`, so changes
 * apply to subsequent Discover requests without a server restart.
 */
export function Matching() {
	// External-cache retention (existing knob, dedicated key).
	const [retention, setRetention] = useState<number>(DEFAULT_RETENTION);
	const [retentionLoaded, setRetentionLoaded] = useState(false);
	const [retentionSaving, setRetentionSaving] = useState(false);

	// Aggregate tuning config (loaded in one shot from /settings/matching).
	const [cfg, setCfg] = useState<MatchingConfig | null>(null);
	const [saving, setSaving] = useState<string | null>(null);

	// IMDB datasets enable / status / manual-sync.
	const [imdb, setImdb] = useState<ImdbDatasetsState | null>(null);
	const [imdbBusy, setImdbBusy] = useState(false);

	const refreshImdbStatus = () =>
		api
			.get<ImdbDatasetsState>('/imdb-datasets/status')
			.then(setImdb)
			.catch(() => {});

	useEffect(() => {
		settingsService
			.get(RETENTION_KEY)
			.then((value) => {
				if (typeof value === 'number') setRetention(value);
				else if (typeof value === 'string') {
					if (value === 'never') setRetention(-1);
					else {
						const n = parseInt(value, 10);
						if (!Number.isNaN(n)) setRetention(n);
					}
				}
			})
			.catch(() => {})
			.finally(() => setRetentionLoaded(true));

		api.get<MatchingConfig>('/settings/matching')
			.then(setCfg)
			.catch((err) => notifyError(`Failed to load tuning config: ${err?.message ?? err}`));

		void refreshImdbStatus();
	}, []);

	const toggleImdb = async (enabled: boolean) => {
		setImdbBusy(true);
		try {
			await api.put('/imdb-datasets/enabled', { enabled });
			await refreshImdbStatus();
			notifySuccess(
				enabled
					? 'IMDB datasets enabled — nightly sync scheduled'
					: 'IMDB datasets disabled',
			);
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to toggle IMDB datasets');
		} finally {
			setImdbBusy(false);
		}
	};

	const triggerImdbSync = async () => {
		setImdbBusy(true);
		try {
			await api.post('/imdb-datasets/sync');
			notifySuccess('IMDB sync started — runs in the background');
			// Poll briefly so the status row updates without a manual refresh.
			setTimeout(refreshImdbStatus, 4000);
			setTimeout(refreshImdbStatus, 15000);
			setTimeout(refreshImdbStatus, 45000);
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to start sync');
		} finally {
			setImdbBusy(false);
		}
	};

	const updateRetention = async (value: number) => {
		setRetention(value);
		setRetentionSaving(true);
		try {
			await settingsService.set(RETENTION_KEY, value);
			notifySuccess('Eviction window updated');
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to save');
		} finally {
			setRetentionSaving(false);
		}
	};

	/** Generic patch — writes one setting key, mirrors into local cfg state. */
	const patch = async <K extends keyof MatchingConfig>(
		key: K,
		settingKey: string,
		value: MatchingConfig[K],
	) => {
		if (!cfg) return;
		const previous = cfg[key];
		setCfg({ ...cfg, [key]: value });
		setSaving(settingKey);
		try {
			await settingsService.set(settingKey, value as unknown);
		} catch (err: any) {
			notifyError(err?.message ?? `Failed to save ${settingKey}`);
			setCfg({ ...cfg, [key]: previous });
		} finally {
			setSaving(null);
		}
	};

	const updateWeight = async (strategy: string, value: number) => {
		if (!cfg) return;
		const next = { ...cfg.strategyWeights, [strategy]: value };
		const previous = cfg.strategyWeights;
		setCfg({ ...cfg, strategyWeights: next });
		setSaving('recommendations.strategyWeights');
		try {
			await settingsService.set('recommendations.strategyWeights', next);
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to save weights');
			setCfg({ ...cfg, strategyWeights: previous });
		} finally {
			setSaving(null);
		}
	};

	return (
		<div class={styles.wrap}>
			<div class={styles.intro}>
				<h2 class={styles.heading}>Matching</h2>
				<p class={styles.lede}>
					Tune how Mu finds similar movies. Defaults work well — change these if you want
					more adventurous results, longer cache retention, or tighter spend on paid
					providers.
				</p>
			</div>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>IMDB datasets (offline ratings)</h3>
					<p class={styles.sectionLede}>
						Free daily download from IMDB's public bulk dumps. The ratings table (~25
						MB, ~1.4M titles) lives locally so rating lookups don't burn OMDB quota and
						ratings stay daily-fresh. Future scope: cast / title metadata for
						fully-local similarity searches.
					</p>
				</div>
				<ToggleRow
					label="Enable IMDB datasets sync"
					description="Schedules a nightly sync of title.ratings.tsv.gz into a local SQLite table. The first run downloads ~25 MB and takes ~30 seconds."
					checked={!!imdb?.enabled}
					disabled={imdb == null || imdbBusy}
					onChange={toggleImdb}
				/>
				{imdb?.datasets?.map((ds) => (
					<div class={styles.controlRow} key={ds.id}>
						<div class={styles.toggleInfo}>
							<span class={styles.toggleLabel}>{ds.displayName}</span>
							<span class={styles.toggleDescription}>
								{ds.rowCount > 0 ? (
									<>
										{ds.rowCount.toLocaleString()} rows ·{' '}
										{ds.lastSyncAt
											? `synced ${new Date(ds.lastSyncAt).toLocaleString()}`
											: 'not yet synced'}
										{ds.lastSyncDurationMs != null && ds.lastSyncDurationMs > 0
											? ` · ${(ds.lastSyncDurationMs / 1000).toFixed(1)}s`
											: ''}
									</>
								) : ds.running ? (
									<>Sync running — first import may take 30–60s…</>
								) : (
									<>
										Not yet synced. ~{ds.approxSizeMb} MB / ~1.4M ratings on
										first run.
									</>
								)}
								{ds.lastError ? (
									<>
										<br />
										<span style={{ color: 'var(--color-danger, #ef4444)' }}>
											Last error: {ds.lastError}
										</span>
									</>
								) : null}
							</span>
						</div>
						<button
							type="button"
							class={styles.linkButton}
							disabled={!imdb.enabled || ds.running || imdbBusy}
							onClick={triggerImdbSync}
						>
							{ds.running ? 'Syncing…' : 'Sync now'}
						</button>
					</div>
				))}
			</section>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>External cache retention</h3>
					<p class={styles.sectionLede}>
						When Discover surfaces movies you don't own, Mu caches them (metadata +
						embeddings) so subsequent ranking is fast. Untouched entries beyond this
						window are evicted automatically.
					</p>
				</div>
				<div class={styles.controlRow}>
					<label class={styles.controlLabel} for="retention-select">
						Keep external candidates for
					</label>
					<Select<number>
						id="retention-select"
						value={retention}
						disabled={!retentionLoaded || retentionSaving}
						options={RETENTION_OPTIONS}
						onChange={(v) => updateRetention(v)}
					/>
				</div>
			</section>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Strategy weights</h3>
					<p class={styles.sectionLede}>
						The recommender blends four strategies. Heavier weight = that strategy's
						hits surface higher. Zero = strategy is disabled. Values are normalised at
						scoring time, so absolute numbers don't have to sum to 1.
					</p>
				</div>
				{STRATEGY_ORDER.map((s) => {
					const w = cfg?.strategyWeights?.[s] ?? 0;
					return (
						<div class={styles.controlRow} key={s}>
							<label class={styles.controlLabel}>{STRATEGY_LABELS[s] ?? s}</label>
							<input
								type="range"
								min={0}
								max={1}
								step={0.05}
								value={w}
								disabled={!cfg || saving === 'recommendations.strategyWeights'}
								onChange={(e) =>
									updateWeight(
										s,
										Math.round(
											parseFloat((e.target as HTMLInputElement).value) * 100,
										) / 100,
									)
								}
							/>
							<span class={styles.sliderValue}>{w.toFixed(2)}</span>
						</div>
					);
				})}
			</section>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Diversity & quality</h3>
					<p class={styles.sectionLede}>
						MMR λ trades off relevance vs diversity (1 = pure relevance, 0 = max
						spread). Quality floor drops candidates whose TMDB/IMDB rating falls below
						the threshold.
					</p>
				</div>
				<div class={styles.controlRow}>
					<label class={styles.controlLabel}>MMR λ (diversity)</label>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={cfg?.mmrLambda ?? 0.7}
						disabled={!cfg || saving === 'recommendations.mmrLambda'}
						onChange={(e) =>
							patch(
								'mmrLambda',
								'recommendations.mmrLambda',
								Math.round(parseFloat((e.target as HTMLInputElement).value) * 100) /
									100,
							)
						}
					/>
					<span class={styles.sliderValue}>{(cfg?.mmrLambda ?? 0.7).toFixed(2)}</span>
				</div>
				<div class={styles.controlRow}>
					<label class={styles.controlLabel}>Quality floor (0–10)</label>
					<input
						type="number"
						min={0}
						max={10}
						step={0.1}
						class={styles.select}
						style={{ width: '90px' }}
						value={cfg?.qualityFloor ?? 0}
						disabled={!cfg || saving === 'recommendations.qualityFloor'}
						onChange={(e) => {
							const raw = (e.target as HTMLInputElement).value;
							const n = raw === '' ? 0 : parseFloat(raw);
							patch(
								'qualityFloor',
								'recommendations.qualityFloor',
								Number.isFinite(n) ? n : 0,
							);
						}}
					/>
				</div>
			</section>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Exclusion filters</h3>
					<p class={styles.sectionLede}>
						Trim results before they're returned. Same-group hides sequels of the seed;
						watched hides already-played movies; the director cap stops a single
						filmmaker from dominating the list.
					</p>
				</div>
				<ToggleRow
					label="Exclude same group as seed"
					description="Skip movies that share the seed's collection / series."
					checked={cfg?.excludeSameGroup ?? true}
					disabled={!cfg || saving === 'recommendations.excludeSameGroup'}
					onChange={(v) =>
						patch('excludeSameGroup', 'recommendations.excludeSameGroup', v)
					}
				/>
				<ToggleRow
					label="Exclude already-watched"
					description="Hide movies you've finished. Continue-watching elsewhere is unaffected."
					checked={cfg?.excludeWatched ?? false}
					disabled={!cfg || saving === 'recommendations.excludeWatched'}
					onChange={(v) => patch('excludeWatched', 'recommendations.excludeWatched', v)}
				/>
				<div class={styles.toggleRow}>
					<div class={styles.toggleInfo}>
						<span class={styles.toggleLabel}>Max movies per director</span>
						<span class={styles.toggleDescription}>
							Caps how many movies from any one director appear in a single set of
							results — keeps a prolific filmmaker from monopolising your Discover
							grid. Default 2. Set 0 for no cap.
						</span>
					</div>
					<input
						type="number"
						min={0}
						max={10}
						step={1}
						class={styles.select}
						style={{ width: '70px', flexShrink: 0 }}
						value={cfg?.perDirectorCap ?? 2}
						disabled={!cfg || saving === 'recommendations.perDirectorCap'}
						onChange={(e) => {
							const raw = (e.target as HTMLInputElement).value;
							const n = raw === '' ? 0 : parseInt(raw, 10);
							patch(
								'perDirectorCap',
								'recommendations.perDirectorCap',
								Number.isFinite(n) ? n : 2,
							);
						}}
					/>
				</div>
			</section>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Multi-input policy</h3>
					<p class={styles.sectionLede}>
						When Discover has more than one seed, how should they combine? Centroid
						averages the seeds (best for similar movies). Union-of-neighbours runs each
						seed independently and merges (best for variety). Auto picks based on
						seed-set variance.
					</p>
				</div>
				<div class={styles.controlRow}>
					<Select<'auto' | 'centroid' | 'union'>
						value={cfg?.multiInputPolicy ?? 'auto'}
						disabled={!cfg || saving === 'recommendations.multiInputPolicy'}
						options={[
							{ label: 'Auto (recommended)', value: 'auto' },
							{ label: 'Centroid (averaged seeds)', value: 'centroid' },
							{
								label: 'Union of neighbours (per-seed merge)',
								value: 'union',
							},
						]}
						onChange={(v) =>
							patch('multiInputPolicy', 'recommendations.multiInputPolicy', v)
						}
					/>
				</div>
			</section>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Auto-enrichment</h3>
					<p class={styles.sectionLede}>
						When a movie is added or updated, Mu can pre-fetch enrichment data so
						Discover ranks it well immediately. Turn anything off here to reduce API
						spend or skip slow steps.
					</p>
				</div>
				<ToggleRow
					label="External recommendations (TMDB / Trakt)"
					description="Snapshot similar + recommended lists from TMDB on add. Free, fast."
					checked={cfg?.autoEnrichExternalRecs ?? true}
					disabled={!cfg || saving === 'recommendations.autoEnrichExternalRecs'}
					onChange={(v) =>
						patch('autoEnrichExternalRecs', 'recommendations.autoEnrichExternalRecs', v)
					}
				/>
				<ToggleRow
					label="Plot embeddings"
					description="Compute a semantic embedding from the overview. Required for the embedding strategy. Local — no API spend."
					checked={cfg?.autoEnrichEmbeddings ?? true}
					disabled={!cfg || saving === 'recommendations.autoEnrichEmbeddings'}
					onChange={(v) =>
						patch('autoEnrichEmbeddings', 'recommendations.autoEnrichEmbeddings', v)
					}
				/>
				<ToggleRow
					label="LLM-extracted features (tone, pace, themes)"
					description="One Anthropic call per movie. Skipped automatically when no LLM provider is configured. Respects each provider's monthly budget."
					checked={cfg?.autoEnrichLlmFeatures ?? true}
					disabled={!cfg || saving === 'recommendations.autoEnrichLlmFeatures'}
					onChange={(v) =>
						patch('autoEnrichLlmFeatures', 'recommendations.autoEnrichLlmFeatures', v)
					}
				/>
			</section>

			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>LLM monthly budget</h3>
					<p class={styles.sectionLede}>
						Each LLM provider (Anthropic, OpenAI, …) has its own monthly USD ceiling.
						The rate limiter blocks requests once the projected cost would exceed it.
						Configure budgets on the Connections page.
					</p>
				</div>
				<div class={styles.controlRow}>
					<button
						type="button"
						class={styles.linkButton}
						onClick={() => route('/settings/connections')}
					>
						Open Connections settings →
					</button>
				</div>
			</section>
		</div>
	);
}

/** Compact toggle row used by Exclusion + Auto-enrichment sections. */
function ToggleRow({
	label,
	description,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div class={styles.toggleRow}>
			<div class={styles.toggleInfo}>
				<span class={styles.toggleLabel}>{label}</span>
				<span class={styles.toggleDescription}>{description}</span>
			</div>
			<label class={styles.toggle}>
				<input
					type="checkbox"
					checked={checked}
					disabled={disabled}
					onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
				/>
				<span class={styles.toggleTrack} />
			</label>
		</div>
	);
}

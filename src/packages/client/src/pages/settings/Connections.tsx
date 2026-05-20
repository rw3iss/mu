import { useEffect } from 'preact/hooks';
import { ProviderCard } from '@/components/settings/ProviderCard';
import {
	fetchProviders,
	providersError,
	providersList,
	providersLoaded,
	providersLoading,
} from '@/state/providers.state';
import styles from './Connections.module.scss';

/**
 * Settings → Sources panel — lists every registered provider grouped
 * by Connected (credentials present, healthcheck-able) vs Available
 * (registered server-side but not yet configured).
 *
 * Adding a provider on the server (decorator + module providers
 * array) is enough — its card surfaces here automatically, its form
 * is generated from its `configFields`, and credentials persist in
 * `provider_credentials`.
 *
 * Capability legend rendered inline so the user can tell what a
 * source does ('search', 'recommend', 'enrich', 'embed', 'rerank',
 * 'explain') at a glance.
 */
export function Connections() {
	useEffect(() => {
		fetchProviders();
	}, []);

	if (providersLoading.value && !providersLoaded.value) {
		return <div class={styles.loading}>Loading sources…</div>;
	}

	if (providersError.value) {
		return <div class={styles.error}>Failed to load sources: {providersError.value}</div>;
	}

	const list = providersList.value;
	const connected = list.filter((p) => p.isConfigured);
	const available = list.filter((p) => !p.isConfigured);

	return (
		<div class={styles.wrap}>
			<div class={styles.intro}>
				<h2 class={styles.heading}>Sources</h2>
				<p class={styles.lede}>
					External services Mu can use for metadata enrichment, similarity search,
					recommendations, embeddings, and AI analysis. Credentials live in the server's
					database — never in config files or this repo. Adding a new source on the server
					side automatically lists it here for configuration.
				</p>
			</div>

			{list.length === 0 ? (
				<div class={styles.empty}>
					No sources registered. Source modules are wired in the server's metadata and
					recommendations modules — once at least one is registered, configuration cards
					appear here.
				</div>
			) : (
				<>
					{connected.length > 0 && (
						<section class={styles.section}>
							<h3 class={styles.sectionTitle}>
								Connected
								<span class={styles.sectionCount}>{connected.length}</span>
							</h3>
							<div class={styles.grid}>
								{connected.map((p) => (
									<ProviderCard key={p.id} provider={p} />
								))}
							</div>
						</section>
					)}

					{available.length > 0 && (
						<section class={styles.section}>
							<h3 class={styles.sectionTitle}>
								Available
								<span class={styles.sectionCount}>{available.length}</span>
							</h3>
							<p class={styles.sectionLede}>
								Click any source to add credentials. Free providers (e.g. Wikidata)
								work without a key.
							</p>
							<div class={styles.grid}>
								{available.map((p) => (
									<ProviderCard key={p.id} provider={p} />
								))}
							</div>
						</section>
					)}
				</>
			)}
		</div>
	);
}

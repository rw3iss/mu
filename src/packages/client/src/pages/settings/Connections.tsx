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
 * Admin "Connections" panel — lists every registered provider and
 * lets the admin configure credentials. Until later phases register
 * providers (TMDB recommender, Trakt, embedders, LLM clients), this
 * page renders an empty state.
 */
export function Connections() {
	useEffect(() => {
		fetchProviders();
	}, []);

	if (providersLoading.value && !providersLoaded.value) {
		return <div class={styles.loading}>Loading providers…</div>;
	}

	if (providersError.value) {
		return <div class={styles.error}>Failed to load providers: {providersError.value}</div>;
	}

	const list = providersList.value;

	return (
		<div class={styles.wrap}>
			<div class={styles.intro}>
				<h2 class={styles.heading}>Connections</h2>
				<p class={styles.lede}>
					External services Mu can use for recommendations, enrichment, embeddings, and AI
					analysis. API keys live in the server's database — never in config files or this
					repo.
				</p>
			</div>
			{list.length === 0 ? (
				<div class={styles.empty}>
					No providers registered yet. Adding TMDB, Trakt, OpenAI, Anthropic, etc. happens
					during later feature phases — once registered they'll appear here for
					configuration.
				</div>
			) : (
				<div class={styles.grid}>
					{list.map((p) => (
						<ProviderCard key={p.id} provider={p} />
					))}
				</div>
			)}
		</div>
	);
}

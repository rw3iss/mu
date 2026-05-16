import { signal } from '@preact/signals';
import { type ProviderSummary, providersService } from '@/services/providers.service';

/**
 * Cached list of registered providers from the server. Loaded on
 * demand by the Connections page (and any later consumer that needs
 * to know what providers exist).
 */
export const providersList = signal<ProviderSummary[]>([]);
export const providersLoaded = signal<boolean>(false);
export const providersLoading = signal<boolean>(false);
export const providersError = signal<string | null>(null);

export async function fetchProviders(force = false): Promise<void> {
	if (providersLoaded.value && !force) return;
	providersLoading.value = true;
	providersError.value = null;
	try {
		const { providers } = await providersService.list();
		providersList.value = providers;
		providersLoaded.value = true;
	} catch (err: any) {
		providersError.value = err?.message ?? 'Failed to load providers';
	} finally {
		providersLoading.value = false;
	}
}

export function invalidateProviders(): void {
	providersLoaded.value = false;
}

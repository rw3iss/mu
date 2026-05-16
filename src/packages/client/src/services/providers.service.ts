import { api } from './api';

export type Capability = 'recommend' | 'enrich' | 'embed' | 'rerank' | 'explain';

export interface ConfigFieldSpec {
	key: string;
	label: string;
	description?: string;
	type: 'string' | 'secret' | 'number' | 'boolean';
	required?: boolean;
	defaultValue?: unknown;
}

export interface RateLimitSpec {
	perSecond?: number;
	perMinute?: number;
	perDay?: number;
	perMonth?: number;
	costPerCall?: number;
	monthlyBudgetUsd?: number;
}

export interface ProviderSummary {
	id: string;
	displayName: string;
	description?: string;
	capabilities: Capability[];
	auth: 'apiKey' | 'oauth' | 'none';
	configFields: ConfigFieldSpec[];
	rateLimit: RateLimitSpec;
	isConfigured: boolean;
}

export interface UsageSnapshot {
	second: number;
	minute: number;
	day: number;
	month: number;
	monthCost: number;
}

export interface DailyHistoryPoint {
	date: string;
	count: number;
}

export interface DailyEventSummary {
	date: string;
	calls: number;
	errors: number;
	avgLatency: number | null;
	costUsd: number;
}

export interface ProviderEvent {
	id: string;
	providerId: string;
	eventType: 'call' | 'error' | 'rate_limit' | 'budget_exhausted' | 'health_check';
	statusCode: number | null;
	durationMs: number | null;
	costUsd: number | null;
	payload: string | null;
	occurredAt: string;
}

export interface ProviderDetail extends ProviderSummary {
	config: Record<string, unknown> | null;
	usage: UsageSnapshot;
	dailyUsage: DailyHistoryPoint[];
	recentEvents: ProviderEvent[];
}

export interface HealthCheckResult {
	ok: boolean;
	detail?: string;
	checkedAt: string;
}

export const providersService = {
	list: () => api.get<{ providers: ProviderSummary[] }>('/providers'),
	get: (id: string) => api.get<ProviderDetail>(`/providers/${id}`),
	saveCredentials: (id: string, config: Record<string, unknown>) =>
		api.put<{ ok: boolean; isConfigured: boolean }>(`/providers/${id}/credentials`, {
			config,
		}),
	deleteCredentials: (id: string) => api.delete<{ ok: boolean }>(`/providers/${id}/credentials`),
	setEnabled: (id: string, enabled: boolean) =>
		api.patch<{ ok: boolean; enabled: boolean }>(`/providers/${id}`, { enabled }),
	test: (id: string) => api.post<HealthCheckResult>(`/providers/${id}/test`, {}),
	usage: (id: string, days = 7) =>
		api.get<{
			snapshot: UsageSnapshot;
			daily: DailyHistoryPoint[];
			eventDaily: DailyEventSummary[];
		}>(`/providers/${id}/usage?days=${days}`),
};

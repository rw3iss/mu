import { useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import type { ProviderSummary } from '@/services/providers.service';
import styles from './ProviderCard.module.scss';
import { ProviderConfigModal } from './ProviderConfigModal';

interface ProviderCardProps {
	provider: ProviderSummary;
}

/**
 * Single card on the Connections page. Renders provider metadata,
 * status, capabilities, and the Configure / Test buttons. Heavy
 * lifting (form, save, test) lives in ProviderConfigModal.
 */
export function ProviderCard({ provider }: ProviderCardProps) {
	const [open, setOpen] = useState(false);

	const status: { label: string; tone: 'active' | 'idle' | 'error' } = provider.isConfigured
		? { label: 'Active', tone: 'active' }
		: { label: 'Not configured', tone: 'idle' };

	return (
		<>
			<div class={styles.card}>
				<div class={styles.header}>
					<div class={styles.title}>{provider.displayName}</div>
					<span class={`${styles.status} ${styles[status.tone]}`}>{status.label}</span>
				</div>
				{provider.description && (
					<div class={styles.description}>{provider.description}</div>
				)}
				<div class={styles.capabilities}>
					{provider.capabilities.map((c) => (
						<span key={c} class={styles.cap}>
							{c}
						</span>
					))}
					{provider.auth !== 'none' && <span class={styles.cap}>{provider.auth}</span>}
				</div>
				<div class={styles.actions}>
					<Button size="sm" onClick={() => setOpen(true)}>
						{provider.isConfigured ? 'Edit' : 'Configure'}
					</Button>
				</div>
			</div>
			<ProviderConfigModal provider={provider} isOpen={open} onClose={() => setOpen(false)} />
		</>
	);
}

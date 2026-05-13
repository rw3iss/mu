import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import {
	providersService,
	type ConfigFieldSpec,
	type ProviderSummary,
} from '@/services/providers.service';
import { fetchProviders } from '@/state/providers.state';
import styles from './ProviderConfigModal.module.scss';

interface ProviderConfigModalProps {
	provider: ProviderSummary;
	isOpen: boolean;
	onClose: () => void;
}

/**
 * Modal for editing a provider's credentials. The form is generated
 * directly from the provider's `configFields` schema — there is no
 * provider-specific UI code here. Adding a new provider on the server
 * gives it a working settings form on the client automatically.
 */
export function ProviderConfigModal({ provider, isOpen, onClose }: ProviderConfigModalProps) {
	const [values, setValues] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		// Pre-fill from server-side current (masked) values.
		providersService
			.get(provider.id)
			.then((detail) => {
				const next: Record<string, string> = {};
				for (const f of provider.configFields) {
					const v = detail.config?.[f.key];
					next[f.key] = v == null ? '' : String(v);
				}
				setValues(next);
			})
			.catch((err) => notifyError(err?.message ?? 'Failed to load credentials'));
	}, [isOpen, provider.id]);

	const update = (key: string, val: string) => {
		setValues((prev) => ({ ...prev, [key]: val }));
	};

	const save = async () => {
		setSaving(true);
		try {
			const config: Record<string, unknown> = {};
			for (const f of provider.configFields) {
				const v = values[f.key] ?? '';
				if (f.type === 'number') {
					config[f.key] = v === '' ? null : Number(v);
				} else if (f.type === 'boolean') {
					config[f.key] = v === 'true';
				} else {
					config[f.key] = v;
				}
			}
			await providersService.saveCredentials(provider.id, config);
			await fetchProviders(true);
			notifySuccess(`${provider.displayName} configured`);
			onClose();
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to save');
		} finally {
			setSaving(false);
		}
	};

	const test = async () => {
		setTesting(true);
		try {
			const result = await providersService.test(provider.id);
			if (result.ok) {
				notifySuccess(`${provider.displayName} — connection OK`);
			} else {
				notifyError(result.detail ?? 'Health check failed');
			}
		} catch (err: any) {
			notifyError(err?.message ?? 'Test failed');
		} finally {
			setTesting(false);
		}
	};

	const remove = async () => {
		try {
			await providersService.deleteCredentials(provider.id);
			await fetchProviders(true);
			notifySuccess('Credentials removed');
			onClose();
		} catch (err: any) {
			notifyError(err?.message ?? 'Failed to remove');
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} title={`Configure ${provider.displayName}`}>
			<div class={styles.body}>
				{provider.description && <p class={styles.description}>{provider.description}</p>}
				<div class={styles.fields}>
					{provider.configFields.length === 0 && (
						<div class={styles.empty}>This provider has no configuration options.</div>
					)}
					{provider.configFields.map((field) => (
						<FieldRow
							key={field.key}
							field={field}
							value={values[field.key] ?? ''}
							onChange={(v) => update(field.key, v)}
						/>
					))}
				</div>
				<div class={styles.actions}>
					<div>
						{provider.isConfigured && (
							<Button variant="danger" onClick={remove}>
								Remove
							</Button>
						)}
					</div>
					<div class={styles.rightActions}>
						<Button variant="ghost" onClick={test} disabled={testing}>
							{testing ? 'Testing…' : 'Test'}
						</Button>
						<Button onClick={save} disabled={saving}>
							{saving ? 'Saving…' : 'Save'}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}

function FieldRow({
	field,
	value,
	onChange,
}: {
	field: ConfigFieldSpec;
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<label class={styles.field}>
			<span class={styles.fieldLabel}>
				{field.label}
				{field.required && <span class={styles.required}> *</span>}
			</span>
			{field.description && <span class={styles.fieldHint}>{field.description}</span>}
			{field.type === 'boolean' ? (
				<input
					type="checkbox"
					checked={value === 'true'}
					onChange={(e) => onChange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
				/>
			) : (
				<input
					class={styles.input}
					type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
					value={value}
					required={field.required}
					placeholder={field.type === 'secret' && value.includes('••••') ? value : undefined}
					onInput={(e) => onChange((e.target as HTMLInputElement).value)}
				/>
			)}
		</label>
	);
}

import type { SharedSessionSettings } from '@mu/shared';
import type { ComponentChildren } from 'preact';
import { sharedSessionService } from '@/services/shared-session.service';
import {
	closeSessionSettingsPanel,
	isSessionAdmin,
	sessionSettings,
	showSessionSettingsPanel,
} from '@/state/shared-session.state';
import styles from './SessionSettingsPanel.module.scss';

/** A labelled on/off row. */
function ToggleRow({
	label,
	hint,
	value,
	onChange,
}: {
	label: string;
	hint?: string;
	value: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div class={styles.row}>
			<div class={styles.rowText}>
				<span class={styles.rowLabel}>{label}</span>
				{hint && <span class={styles.rowHint}>{hint}</span>}
			</div>
			<button
				class={`${styles.toggle} ${value ? styles.on : ''}`}
				onClick={() => onChange(!value)}
				aria-label={label}
				aria-pressed={value}
			/>
		</div>
	);
}

/** A labelled control row (select / number). */
function FieldRow({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ComponentChildren;
}) {
	return (
		<div class={styles.row}>
			<div class={styles.rowText}>
				<span class={styles.rowLabel}>{label}</span>
				{hint && <span class={styles.rowHint}>{hint}</span>}
			</div>
			<div class={styles.rowControl}>{children}</div>
		</div>
	);
}

/**
 * Admin-only slide-in panel for the session settings. Modeled on
 * `EffectsPanel`; self-gates on `showSessionSettingsPanel`. Every change is
 * pushed via `updateSettings`, which the server broadcasts to all members.
 */
export function SessionSettingsPanel() {
	if (!showSessionSettingsPanel.value || !isSessionAdmin.value) return null;

	const s = sessionSettings.value;
	const patch = (p: Partial<SharedSessionSettings>) => {
		void sharedSessionService.updateSettings(p);
	};

	return (
		<div
			class={styles.panel}
			data-player-panel
			data-session-settings-panel
			onClick={(e) => e.stopPropagation()}
		>
			<div class={styles.header}>
				<span class={styles.headerTitle}>Session Settings</span>
				<button
					class={styles.closeBtn}
					onClick={closeSessionSettingsPanel}
					aria-label="Close"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>

			<div class={styles.body}>
				<div class={styles.section}>Permissions</div>
				<ToggleRow
					label="Members can control playback"
					hint="Play / pause"
					value={s.allowMembersControl}
					onChange={(v) => patch({ allowMembersControl: v })}
				/>
				<ToggleRow
					label="Members can seek"
					hint="Scrub the timeline"
					value={s.allowSeeking}
					onChange={(v) => patch({ allowSeeking: v })}
				/>
				<ToggleRow
					label="Members can invite others"
					value={s.allowMemberInvites}
					onChange={(v) => patch({ allowMemberInvites: v })}
				/>

				<div class={styles.section}>Features</div>
				<ToggleRow
					label="Enable chat"
					value={s.enableChat}
					onChange={(v) => patch({ enableChat: v })}
				/>
				<ToggleRow
					label="Enable voice"
					value={s.enableVoice}
					onChange={(v) => patch({ enableVoice: v })}
				/>
				<ToggleRow
					label="Show speaking indicator"
					hint='Bottom "X is talking" popup'
					value={s.showSpeakingIndicator}
					onChange={(v) => patch({ showSpeakingIndicator: v })}
				/>
				<FieldRow label="Voice mode">
					<select
						class={styles.select}
						value={s.voiceMode}
						onChange={(e) =>
							patch({
								voiceMode: (e.target as HTMLSelectElement)
									.value as SharedSessionSettings['voiceMode'],
							})
						}
					>
						<option value="open">Open mic</option>
						<option value="ptt">Push-to-talk</option>
					</select>
				</FieldRow>

				<div class={styles.section}>Session</div>
				<FieldRow label="On admin disconnect">
					<select
						class={styles.select}
						value={s.onAdminDisconnect}
						onChange={(e) =>
							patch({
								onAdminDisconnect: (e.target as HTMLSelectElement)
									.value as SharedSessionSettings['onAdminDisconnect'],
							})
						}
					>
						<option value="promote">Promote a member</option>
						<option value="end">End the session</option>
					</select>
				</FieldRow>
				<FieldRow label="Max members">
					<input
						type="number"
						class={styles.number}
						min={2}
						max={16}
						value={s.maxMembers}
						onChange={(e) => {
							const n = parseInt((e.target as HTMLInputElement).value, 10);
							if (Number.isFinite(n))
								patch({ maxMembers: Math.max(2, Math.min(16, n)) });
						}}
					/>
				</FieldRow>

				<div class={styles.section}>Sync</div>
				<FieldRow label="Sync mode">
					<select
						class={styles.select}
						value={s.syncMode}
						onChange={(e) =>
							patch({
								syncMode: (e.target as HTMLSelectElement)
									.value as SharedSessionSettings['syncMode'],
							})
						}
					>
						<option value="soft">Soft (best-effort)</option>
						<option value="hard">Hard (tight)</option>
						<option value="wait-for-all">Wait for all</option>
					</select>
				</FieldRow>
				<FieldRow label="Pre-buffer" hint="Seconds buffered before (re)start">
					<input
						type="number"
						class={styles.number}
						min={0}
						max={30}
						value={s.prebufferSeconds}
						onChange={(e) => {
							const n = parseInt((e.target as HTMLInputElement).value, 10);
							if (Number.isFinite(n))
								patch({ prebufferSeconds: Math.max(0, Math.min(30, n)) });
						}}
					/>
				</FieldRow>
				<FieldRow label="Drift threshold" hint="Seconds before correcting">
					<input
						type="number"
						class={styles.number}
						min={0}
						max={10}
						step={0.5}
						value={s.driftThresholdSeconds}
						onChange={(e) => {
							const n = parseFloat((e.target as HTMLInputElement).value);
							if (Number.isFinite(n))
								patch({ driftThresholdSeconds: Math.max(0, Math.min(10, n)) });
						}}
					/>
				</FieldRow>
			</div>
		</div>
	);
}

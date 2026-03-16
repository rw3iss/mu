import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import {
	activeProfileId,
	compressorEnabled,
	compressorSettings,
	copyProfile,
	deleteProfile,
	effectsTab,
	eqBands,
	eqEnabled,
	fetchProfiles,
	loadProfile,
	profiles,
	renameProfile,
	resetCompressor,
	resetEq,
	saveProfile,
	setEffectsTab,
	showEffectsPanel,
	toggleCompressor,
	toggleEq,
	toggleEffectsPanel,
	updateCompressorParam,
	updateEqBand,
	updateProfile,
} from '@/state/audio-effects.state';
import styles from './EffectsPanel.module.scss';

function formatFreq(hz: number): string {
	return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

function EqTab() {
	const bands = eqBands.value;
	const enabled = eqEnabled.value;

	return (
		<div>
			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>Equalizer</span>
				<button
					class={`${styles.toggle} ${enabled ? styles.on : ''}`}
					onClick={toggleEq}
					aria-label="Toggle EQ"
				/>
			</div>

			<div class={styles.eqGrid}>
				{bands.map((band, i) => (
					<div class={styles.eqBand} key={band.frequency}>
						<span class={styles.eqValue}>
							{band.gain > 0 ? '+' : ''}
							{band.gain.toFixed(1)}
						</span>
						<input
							type="range"
							class={styles.eqSlider}
							min="-12"
							max="12"
							step="0.5"
							value={band.gain}
							onInput={(e) =>
								updateEqBand(i, parseFloat((e.target as HTMLInputElement).value))
							}
							disabled={!enabled}
						/>
						<span class={styles.eqLabel}>{formatFreq(band.frequency)}</span>
					</div>
				))}
			</div>

			<button class={styles.resetBtn} onClick={resetEq}>
				Reset EQ
			</button>
		</div>
	);
}

const COMP_PARAMS = [
	{ key: 'threshold' as const, label: 'Threshold', min: -100, max: 0, step: 1, unit: 'dB' },
	{ key: 'knee' as const, label: 'Knee', min: 0, max: 40, step: 1, unit: 'dB' },
	{ key: 'ratio' as const, label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
	{ key: 'attack' as const, label: 'Attack', min: 0, max: 1, step: 0.001, unit: 's' },
	{ key: 'release' as const, label: 'Release', min: 0, max: 1, step: 0.01, unit: 's' },
	{ key: 'makeupGain' as const, label: 'Makeup Gain', min: 0, max: 24, step: 0.5, unit: 'dB' },
];

function CompressorTab() {
	const enabled = compressorEnabled.value;
	const settings = compressorSettings.value;
	const [reduction, setReduction] = useState(0);
	const rafRef = useRef<number>(0);

	useEffect(() => {
		if (!enabled) {
			setReduction(0);
			return;
		}
		const tick = () => {
			setReduction(audioEngine.getCompressorReduction());
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafRef.current);
	}, [enabled]);

	return (
		<div>
			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>Compressor</span>
				<button
					class={`${styles.toggle} ${enabled ? styles.on : ''}`}
					onClick={toggleCompressor}
					aria-label="Toggle Compressor"
				/>
			</div>

			{COMP_PARAMS.map((param) => (
				<div class={styles.compParam} key={param.key}>
					<div class={styles.compParamHeader}>
						<span class={styles.compParamLabel}>{param.label}</span>
						<span class={styles.compParamValue}>
							{param.key === 'attack' || param.key === 'release'
								? settings[param.key].toFixed(3)
								: settings[param.key].toFixed(1)}
							{param.unit}
						</span>
					</div>
					<input
						type="range"
						class={styles.compSlider}
						min={param.min}
						max={param.max}
						step={param.step}
						value={settings[param.key]}
						onInput={(e) =>
							updateCompressorParam(
								param.key,
								parseFloat((e.target as HTMLInputElement).value),
							)
						}
						disabled={!enabled}
					/>
				</div>
			))}

			{enabled && (
				<div class={styles.reductionMeter}>
					<div class={styles.reductionLabel}>
						Gain Reduction: {reduction.toFixed(1)} dB
					</div>
					<div class={styles.reductionBar}>
						<div
							class={styles.reductionFill}
							style={{ width: `${Math.min(100, Math.abs(reduction) * 2)}%` }}
						/>
					</div>
				</div>
			)}

			<button class={styles.resetBtn} onClick={resetCompressor}>
				Reset Compressor
			</button>
		</div>
	);
}

function ProfileSection() {
	const allProfiles = profiles.value;
	const active = activeProfileId.value;
	const [saving, setSaving] = useState(false);
	const [newName, setNewName] = useState('');
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [renameName, setRenameName] = useState('');

	useEffect(() => {
		fetchProfiles();
	}, []);

	const handleSave = useCallback(async () => {
		if (!newName.trim()) return;
		await saveProfile(newName.trim());
		setNewName('');
		setSaving(false);
	}, [newName]);

	const handleDelete = useCallback(async () => {
		if (!active) return;
		await deleteProfile(active);
		setConfirmDelete(false);
	}, [active]);

	const handleRename = useCallback(async () => {
		if (!active || !renameName.trim()) return;
		await renameProfile(active, renameName.trim());
		setRenaming(false);
	}, [active, renameName]);

	return (
		<div class={styles.profileSection}>
			<div class={styles.profileHeader}>
				<span class={styles.profileLabel}>Profile</span>
				<select
					class={styles.profileSelect}
					value={active ?? ''}
					onChange={(e) => {
						const val = (e.target as HTMLSelectElement).value;
						if (val) loadProfile(val);
					}}
				>
					<option value="">-- None --</option>
					{allProfiles.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
			</div>

			<div class={styles.profileActions}>
				{saving ? (
					<>
						<input
							type="text"
							value={newName}
							onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
							onKeyDown={(e) => e.key === 'Enter' && handleSave()}
							placeholder="Profile name"
							class={styles.profileSelect}
							style={{ flex: 1, marginLeft: 0 }}
							autoFocus
						/>
						<button class={styles.profileBtn} onClick={handleSave}>
							Save
						</button>
						<button class={styles.profileBtn} onClick={() => setSaving(false)}>
							Cancel
						</button>
					</>
				) : renaming ? (
					<>
						<input
							type="text"
							value={renameName}
							onInput={(e) => setRenameName((e.target as HTMLInputElement).value)}
							onKeyDown={(e) => e.key === 'Enter' && handleRename()}
							class={styles.profileSelect}
							style={{ flex: 1, marginLeft: 0 }}
							autoFocus
						/>
						<button class={styles.profileBtn} onClick={handleRename}>
							Rename
						</button>
						<button class={styles.profileBtn} onClick={() => setRenaming(false)}>
							Cancel
						</button>
					</>
				) : (
					<>
						<button class={styles.profileBtn} onClick={() => setSaving(true)}>
							Save New
						</button>
						{active && (
							<>
								<button
									class={styles.profileBtn}
									onClick={() => updateProfile(active)}
								>
									Update
								</button>
								<button
									class={styles.profileBtn}
									onClick={() => copyProfile(active)}
								>
									Copy
								</button>
								<button
									class={styles.profileBtn}
									onClick={() => {
										const p = allProfiles.find((pr) => pr.id === active);
										setRenameName(p?.name ?? '');
										setRenaming(true);
									}}
								>
									Rename
								</button>
								{confirmDelete ? (
									<>
										<button
											class={`${styles.profileBtn} ${styles.danger}`}
											onClick={handleDelete}
										>
											Confirm
										</button>
										<button
											class={styles.profileBtn}
											onClick={() => setConfirmDelete(false)}
										>
											Cancel
										</button>
									</>
								) : (
									<button
										class={`${styles.profileBtn} ${styles.danger}`}
										onClick={() => setConfirmDelete(true)}
									>
										Delete
									</button>
								)}
							</>
						)}
					</>
				)}
			</div>
		</div>
	);
}

export function EffectsPanel() {
	if (!showEffectsPanel.value) return null;

	const tab = effectsTab.value;

	return (
		<div class={styles.panel} onClick={(e) => e.stopPropagation()}>
			<div class={styles.header}>
				<span class={styles.headerTitle}>Audio Effects</span>
				<button class={styles.closeBtn} onClick={toggleEffectsPanel} aria-label="Close">
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

			<div class={styles.tabs}>
				<button
					class={`${styles.tab} ${tab === 'eq' ? styles.active : ''}`}
					onClick={() => setEffectsTab('eq')}
				>
					Equalizer
				</button>
				<button
					class={`${styles.tab} ${tab === 'compressor' ? styles.active : ''}`}
					onClick={() => setEffectsTab('compressor')}
				>
					Compressor
				</button>
			</div>

			<div class={styles.body}>
				{tab === 'eq' ? <EqTab /> : <CompressorTab />}
				<ProfileSection />
			</div>
		</div>
	);
}

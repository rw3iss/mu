import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { audioEngine } from '@/audio/audio-engine';
import { setUiSetting, useUiSetting } from '@/hooks/useUiSetting';
import type { AudioProfile } from '@/services/audio-profiles.service';
import {
	activeCompProfileId,
	activeEqProfileId,
	activeVideoProfileId,
	compressorEnabled,
	compressorSettings,
	copyProfile,
	deleteProfile,
	effectsTab,
	eqBands,
	eqEnabled,
	eqInputGain,
	fetchProfiles,
	loadCompProfile,
	loadEqProfile,
	loadVideoProfile,
	profiles,
	resetCompressor,
	resetEq,
	resetVideoEffects,
	saveCompProfile,
	saveEqProfile,
	saveVideoProfile,
	setEffectsTab,
	showEffectsPanel,
	toggleCompressor,
	toggleEffectsPanel,
	toggleEq,
	toggleVideoEffects,
	updateCompProfile,
	updateCompressorParam,
	updateEqBand,
	updateEqProfile,
	updateInputGain,
	updateVideoParam,
	updateVideoProfile,
	type VideoEffectSettings,
	videoEffects,
	videoEnabled,
} from '@/state/audio-effects.state';
import styles from './EffectsPanel.module.scss';

function formatFreq(hz: number): string {
	return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

// ── Inline Profile Section (used inside each tab) ──

function ProfileControls({
	type,
	activeId,
	onLoad,
	onSave,
	onUpdate,
}: {
	type: 'eq' | 'compressor' | 'video';
	activeId: string | null;
	onLoad: (id: string) => void;
	onSave: (name: string) => Promise<AudioProfile>;
	onUpdate: (id: string, name?: string) => Promise<void>;
}) {
	const allProfiles = profiles.value.filter(
		(p) => p.type === type || (type !== 'video' && p.type === 'full'),
	);
	const [editName, setEditName] = useState('');
	const [confirmDelete, setConfirmDelete] = useState(false);

	useEffect(() => {
		fetchProfiles();
	}, []);

	useEffect(() => {
		if (activeId) {
			const p = allProfiles.find((pr) => pr.id === activeId);
			setEditName(p?.name ?? '');
		} else {
			setEditName('');
		}
	}, [activeId]);

	const handleSave = useCallback(async () => {
		if (activeId) {
			await onUpdate(activeId, editName.trim() || undefined);
		} else {
			await onSave(editName.trim());
		}
	}, [activeId, editName, onUpdate, onSave]);

	const handleDelete = useCallback(async () => {
		if (!activeId) return;
		await deleteProfile(activeId);
		setConfirmDelete(false);
	}, [activeId]);

	return (
		<div class={styles.profileSection}>
			{/* Profile select + clone/delete */}
			<div class={styles.profileRow}>
				<span class={styles.profileLabel}>Profile</span>
				<select
					class={styles.profileSelect}
					value={activeId ?? ''}
					onChange={(e) => {
						const val = (e.target as HTMLSelectElement).value;
						if (val) onLoad(val);
						else {
							if (type === 'eq') {
								activeEqProfileId.value = null;
								setUiSetting('active_eq_profile_id', null);
								resetEq();
							} else if (type === 'compressor') {
								activeCompProfileId.value = null;
								setUiSetting('active_comp_profile_id', null);
								resetCompressor();
							} else if (type === 'video') {
								activeVideoProfileId.value = null;
								setUiSetting('active_video_profile_id', null);
								resetVideoEffects();
							}
						}
					}}
				>
					<option value="">-- None --</option>
					{allProfiles.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
				{activeId && (
					<>
						<button
							class={styles.iconBtn}
							onClick={() => copyProfile(activeId)}
							title="Clone profile"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<rect x="9" y="9" width="13" height="13" rx="2" />
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
							</svg>
						</button>
						{confirmDelete ? (
							<>
								<button
									class={`${styles.iconBtn} ${styles.danger}`}
									onClick={handleDelete}
									title="Confirm delete"
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
									>
										<polyline points="20 6 9 17 4 12" />
									</svg>
								</button>
								<button
									class={styles.iconBtn}
									onClick={() => setConfirmDelete(false)}
									title="Cancel"
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
									>
										<line x1="18" y1="6" x2="6" y2="18" />
										<line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
							</>
						) : (
							<button
								class={`${styles.iconBtn} ${styles.danger}`}
								onClick={() => setConfirmDelete(true)}
								title="Delete profile"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="3 6 5 6 21 6" />
									<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
									<path d="M10 11v6" />
									<path d="M14 11v6" />
									<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
								</svg>
							</button>
						)}
					</>
				)}
			</div>

			{/* Name input + save */}
			<div class={styles.profileRow}>
				<span class={styles.profileLabel}>Name</span>
				<input
					type="text"
					value={editName}
					onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
					onKeyDown={(e) => e.key === 'Enter' && handleSave()}
					class={styles.profileSelect}
					placeholder={activeId ? 'Profile name' : 'New profile name'}
				/>
				<button class={styles.saveBtn} onClick={handleSave} title="Save profile">
					Save
				</button>
			</div>
		</div>
	);
}

// ── Collapsible Settings Wrapper ──

function CollapsibleSettings({
	settingKey,
	children,
}: {
	settingKey: string;
	children: preact.ComponentChildren;
}) {
	const [open, setOpen] = useUiSetting(settingKey, false);
	return (
		<div class={styles.collapsible}>
			<button class={styles.collapsibleToggle} onClick={() => setOpen(!open)}>
				<span>Settings</span>
				<span class={styles.collapsibleArrow}>{open ? '\u25B2' : '\u25BC'}</span>
			</button>
			{open && <div class={styles.collapsibleContent}>{children}</div>}
		</div>
	);
}

// ── EQ Tab ──

function EqTab() {
	const bands = eqBands.value;
	const enabled = eqEnabled.value;
	const inputGain = eqInputGain.value;
	const activeId = activeEqProfileId.value;

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

			<ProfileControls
				type="eq"
				activeId={activeId}
				onLoad={loadEqProfile}
				onSave={saveEqProfile}
				onUpdate={updateEqProfile}
			/>

			<CollapsibleSettings settingKey="effects_eq_settings_open">
				<div class={styles.eqGrid}>
					<div class={styles.eqBand}>
						<span class={styles.eqValue}>
							{inputGain > 0 ? '+' : ''}
							{inputGain.toFixed(1)}
						</span>
						<input
							type="range"
							class={styles.eqSlider}
							min="-12"
							max="12"
							step="0.5"
							value={inputGain}
							onInput={(e) =>
								updateInputGain(parseFloat((e.target as HTMLInputElement).value))
							}
						/>
						<span class={`${styles.eqLabel} ${styles.eqLabelAmp}`}>Amp</span>
					</div>
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
									updateEqBand(
										i,
										parseFloat((e.target as HTMLInputElement).value),
									)
								}
							/>
							<span class={styles.eqLabel}>{formatFreq(band.frequency)}</span>
						</div>
					))}
				</div>

				<button class={styles.resetBtn} onClick={resetEq}>
					Reset EQ
				</button>
			</CollapsibleSettings>
		</div>
	);
}

// ── Compressor Tab ──

const COMP_PARAMS = [
	{ key: 'threshold' as const, label: 'Threshold', min: -100, max: 0, step: 1, unit: 'dB' },
	{ key: 'knee' as const, label: 'Knee', min: 0, max: 40, step: 1, unit: 'dB' },
	{ key: 'ratio' as const, label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
	{ key: 'attack' as const, label: 'Attack', min: 0, max: 1, step: 0.001, unit: 's' },
	{ key: 'release' as const, label: 'Release', min: 0, max: 1, step: 0.01, unit: 's' },
	{
		key: 'makeupGain' as const,
		label: 'Makeup Gain',
		min: 0,
		max: 24,
		step: 0.5,
		unit: 'dB',
	},
];

function CompressorTab() {
	const enabled = compressorEnabled.value;
	const settings = compressorSettings.value;
	const activeId = activeCompProfileId.value;
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

			<ProfileControls
				type="compressor"
				activeId={activeId}
				onLoad={loadCompProfile}
				onSave={saveCompProfile}
				onUpdate={updateCompProfile}
			/>

			<CollapsibleSettings settingKey="effects_comp_settings_open">
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
								style={{
									width: `${Math.min(100, Math.abs(reduction) * 2)}%`,
								}}
							/>
						</div>
					</div>
				)}

				<div class={styles.compParam}>
					<div class={styles.compParamHeader}>
						<span class={styles.compParamLabel}>Mix</span>
						<span class={styles.compParamValue}>
							{Math.round((settings.mix ?? 1) * 100)}%
						</span>
					</div>
					<div class={styles.mixBar}>
						<span class={styles.mixLabel}>Dry</span>
						<input
							type="range"
							class={styles.compSlider}
							min={0}
							max={1}
							step={0.01}
							value={settings.mix ?? 1}
							onInput={(e) =>
								updateCompressorParam(
									'mix',
									parseFloat((e.target as HTMLInputElement).value),
								)
							}
						/>
						<span class={styles.mixLabel}>Wet</span>
					</div>
				</div>

				<button class={styles.resetBtn} onClick={resetCompressor}>
					Reset Compressor
				</button>
			</CollapsibleSettings>
		</div>
	);
}

// ── Video Tab ──

const VIDEO_PARAMS: {
	key: keyof VideoEffectSettings;
	label: string;
	min: number;
	max: number;
	step: number;
	unit: string;
	default: number;
}[] = [
	{ key: 'brightness', label: 'Brightness', min: 0, max: 200, step: 1, unit: '%', default: 100 },
	{ key: 'contrast', label: 'Contrast', min: 0, max: 200, step: 1, unit: '%', default: 100 },
	{ key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, unit: '%', default: 100 },
	{
		key: 'hueRotate',
		label: 'Hue Rotate',
		min: 0,
		max: 360,
		step: 1,
		unit: '\u00B0',
		default: 0,
	},
	{ key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, unit: '%', default: 0 },
	{ key: 'grayscale', label: 'Grayscale', min: 0, max: 100, step: 1, unit: '%', default: 0 },
];

function VideoTab() {
	const enabled = videoEnabled.value;
	const settings = videoEffects.value;
	const activeId = activeVideoProfileId.value;

	return (
		<div>
			<div class={styles.toggleRow}>
				<span class={styles.toggleLabel}>Video Effects</span>
				<button
					class={`${styles.toggle} ${enabled ? styles.on : ''}`}
					onClick={toggleVideoEffects}
					aria-label="Toggle Video Effects"
				/>
			</div>

			<ProfileControls
				type="video"
				activeId={activeId}
				onLoad={loadVideoProfile}
				onSave={saveVideoProfile}
				onUpdate={updateVideoProfile}
			/>

			<CollapsibleSettings settingKey="effects_video_settings_open">
				{VIDEO_PARAMS.map((param) => (
					<div class={styles.compParam} key={param.key}>
						<div class={styles.compParamHeader}>
							<span class={styles.compParamLabel}>
								{param.label}
								{settings[param.key] !== param.default && (
									<button
										class={styles.paramResetBtn}
										onClick={() => updateVideoParam(param.key, param.default)}
										title={`Reset to ${param.default}${param.unit}`}
									>
										<svg
											width="10"
											height="10"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<polyline points="1 4 1 10 7 10" />
											<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
										</svg>
									</button>
								)}
							</span>
							<span class={styles.compParamValue}>
								{settings[param.key]}
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
							onDblClick={() => updateVideoParam(param.key, param.default)}
							onInput={(e) =>
								updateVideoParam(
									param.key,
									parseFloat((e.target as HTMLInputElement).value),
								)
							}
						/>
					</div>
				))}

				<button class={styles.resetBtn} onClick={resetVideoEffects}>
					Reset Video Effects
				</button>
			</CollapsibleSettings>
		</div>
	);
}

// ── Main Panel ──

function getActiveProfileName(allProfiles: AudioProfile[], activeId: string | null): string | null {
	if (!activeId) return null;
	const p = allProfiles.find((pr) => pr.id === activeId);
	return p?.name ?? null;
}

export function EffectsPanel() {
	if (!showEffectsPanel.value) return null;

	const tab = effectsTab.value;
	const allProfiles = profiles.value;
	const isEqEnabled = eqEnabled.value;
	const isCompEnabled = compressorEnabled.value;
	const isVideoEnabled = videoEnabled.value;
	const eqProfileName = getActiveProfileName(allProfiles, activeEqProfileId.value);
	const compProfileName = getActiveProfileName(allProfiles, activeCompProfileId.value);
	const videoProfileName = getActiveProfileName(allProfiles, activeVideoProfileId.value);

	return (
		<div class={styles.panel} data-player-panel onClick={(e) => e.stopPropagation()}>
			<div class={styles.header}>
				<span class={styles.headerTitle}>Effects</span>
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
					<span>EQ{isEqEnabled && <span class={styles.onBadge}>ON</span>}</span>
					{eqProfileName && <span class={styles.tabProfileName}>{eqProfileName}</span>}
				</button>
				<button
					class={`${styles.tab} ${tab === 'compressor' ? styles.active : ''}`}
					onClick={() => setEffectsTab('compressor')}
				>
					<span>Comp{isCompEnabled && <span class={styles.onBadge}>ON</span>}</span>
					{compProfileName && (
						<span class={styles.tabProfileName}>{compProfileName}</span>
					)}
				</button>
				<button
					class={`${styles.tab} ${tab === 'video' ? styles.active : ''}`}
					onClick={() => setEffectsTab('video')}
				>
					<span>Video{isVideoEnabled && <span class={styles.onBadge}>ON</span>}</span>
					{videoProfileName && (
						<span class={styles.tabProfileName}>{videoProfileName}</span>
					)}
				</button>
			</div>

			<div class={styles.body}>
				{tab === 'eq' && <EqTab />}
				{tab === 'compressor' && <CompressorTab />}
				{tab === 'video' && <VideoTab />}
			</div>
		</div>
	);
}

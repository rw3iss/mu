import { useCallback, useEffect, useState } from 'preact/hooks';
import { Select } from '@/components/common/Select';
import { setUiSetting } from '@/hooks/useUiSetting';
import type { AudioProfile } from '@/services/audio-profiles.service';
import { resetCompressor, resetEq } from '@/state/audio-effects.state';
import {
	activeCompProfileId,
	activeEqProfileId,
	activeVideoProfileId,
	copyProfile,
	deleteProfile,
	fetchProfiles,
	profiles,
} from '@/state/audio-profiles.state';
import { resetVideoEffects } from '@/state/video-effects.state';
import styles from '../EffectsPanel.module.scss';

/**
 * Profile dropdown + name input + save / clone / delete row, used
 * by all three effects tabs (EQ, Compressor, Video). Lives in its
 * own file so the panel itself stays focused on layout / tab routing.
 */

interface ProfileControlsProps {
	type: 'eq' | 'compressor' | 'video';
	activeId: string | null;
	onLoad: (id: string) => void;
	onSave: (name: string) => Promise<AudioProfile>;
	onUpdate: (id: string, name?: string) => Promise<void>;
}

export function ProfileControls({
	type,
	activeId,
	onLoad,
	onSave,
	onUpdate,
}: ProfileControlsProps) {
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
				<Select
					value={activeId ?? ''}
					onChange={(val) => {
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
					options={[
						{ value: '', label: '— None —' },
						...allProfiles.map((p) => ({ value: p.id, label: p.name })),
					]}
				/>
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

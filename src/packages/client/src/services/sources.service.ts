import type { MediaKind } from '@mu/shared';
import { api } from './api';

export interface MediaSourceDto {
	id: string;
	path: string;
	label: string | null;
	/** 'video' (movie folder) | 'audio' (music folder). */
	kind: MediaKind;
	scanIntervalHours: number;
	enabled: boolean;
	/** At most one source is the default (upload target preselection). */
	isDefault?: boolean;
	lastScannedAt: string | null;
	fileCount: number;
	totalSizeBytes: number;
	createdAt: string;
	updatedAt: string;
	/** Set on create when the path overlaps a source of the other kind. */
	warning?: string;
}

export interface BrowseResult {
	currentPath: string;
	parentPath: string | null;
	directories: { name: string; path: string }[];
}

export interface ValidateResult {
	exists: boolean;
	isDirectory: boolean;
	readable: boolean;
}

export interface SyncResult {
	created: MediaSourceDto[];
	removed: string[];
	kept: MediaSourceDto[];
}

export interface ScanResult {
	message: string;
	filesFound: number;
	filesAdded: number;
	filesUpdated: number;
	filesRemoved: number;
}

export interface ScanStatusResult {
	autoScanEnabled: boolean;
	scanIntervalHours: number;
	nextScanAt: string | null;
	lastScanAt: string | null;
}

export const sourcesService = {
	/** All sources, or only one kind (movie folders = 'video', music = 'audio'). */
	getAll(kind?: MediaKind) {
		return api.get<MediaSourceDto[]>('/sources', kind ? { kind } : undefined);
	},

	create(path: string, label?: string, kind: MediaKind = 'video') {
		return api.post<MediaSourceDto>('/sources', { path, label, kind });
	},

	update(id: string, data: Partial<{ label: string; enabled: boolean; isDefault: boolean }>) {
		return api.patch<MediaSourceDto>(`/sources/${id}`, data);
	},

	/**
	 * The default media source: explicit default flag → the single source →
	 * the first source. Null when there are no sources.
	 */
	resolveDefault(sources: MediaSourceDto[]): MediaSourceDto | null {
		if (sources.length === 0) return null;
		return sources.find((s) => s.isDefault) ?? sources[0]!;
	},

	remove(id: string) {
		return api.delete<{ success: boolean }>(`/sources/${id}`);
	},

	scan(id: string) {
		return api.post<ScanResult>(`/sources/${id}/scan`);
	},

	scanAll() {
		return api.post<ScanResult>('/sources/scan');
	},

	/** Replace the set of `kind` sources with `paths` (other kinds untouched). */
	sync(paths: string[], kind: MediaKind = 'video') {
		return api.put<SyncResult>('/sources/sync', { paths, kind });
	},

	browse(path?: string) {
		return api.get<BrowseResult>('/filesystem/browse', path ? { path } : undefined);
	},

	validate(path: string) {
		return api.get<ValidateResult>('/filesystem/validate', { path });
	},

	getScanStatus() {
		return api.get<ScanStatusResult>('/sources/scan-status');
	},

	refreshSchedule() {
		return api.post<ScanStatusResult>('/sources/refresh-schedule');
	},
};

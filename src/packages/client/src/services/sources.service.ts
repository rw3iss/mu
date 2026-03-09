import { api } from './api';

export interface MediaSourceDto {
	id: string;
	path: string;
	label: string | null;
	scanIntervalHours: number;
	enabled: boolean;
	lastScannedAt: string | null;
	fileCount: number;
	totalSizeBytes: number;
	createdAt: string;
	updatedAt: string;
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
	getAll() {
		return api.get<MediaSourceDto[]>('/sources');
	},

	create(path: string, label?: string) {
		return api.post<MediaSourceDto>('/sources', { path, label });
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

	sync(paths: string[]) {
		return api.put<SyncResult>('/sources/sync', { paths });
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

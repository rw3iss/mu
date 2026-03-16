import { api } from './api';

export interface AudioProfile {
	id: string;
	userId: string;
	name: string;
	type: string;
	config: string;
	isDefault: boolean;
	createdAt: string;
	updatedAt: string;
}

export const audioProfilesService = {
	getAll(): Promise<AudioProfile[]> {
		return api.get<AudioProfile[]>('/audio-profiles');
	},

	getOne(id: string): Promise<AudioProfile> {
		return api.get<AudioProfile>(`/audio-profiles/${id}`);
	},

	create(data: {
		name: string;
		type: string;
		config: string;
		isDefault?: boolean;
	}): Promise<AudioProfile> {
		return api.post<AudioProfile>('/audio-profiles', data);
	},

	update(
		id: string,
		data: { name?: string; config?: string; isDefault?: boolean },
	): Promise<AudioProfile> {
		return api.put<AudioProfile>(`/audio-profiles/${id}`, data);
	},

	remove(id: string): Promise<void> {
		return api.delete<void>(`/audio-profiles/${id}`);
	},
};

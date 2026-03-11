import { readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';

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

@Injectable()
export class FilesystemService {
	async browse(dirPath: string): Promise<BrowseResult> {
		const resolved = resolve(dirPath || '/');
		const entries = await readdir(resolved, { withFileTypes: true });

		const directories = entries
			.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
			.map((e) => ({ name: e.name, path: resolve(resolved, e.name) }))
			.sort((a, b) => a.name.localeCompare(b.name));

		const parent = resolved === '/' ? null : dirname(resolved);

		return { currentPath: resolved, parentPath: parent, directories };
	}

	async validate(dirPath: string): Promise<ValidateResult> {
		try {
			const info = await stat(dirPath);
			return { exists: true, isDirectory: info.isDirectory(), readable: true };
		} catch (err: any) {
			if (err.code === 'ENOENT') {
				return { exists: false, isDirectory: false, readable: false };
			}
			if (err.code === 'EACCES') {
				return { exists: true, isDirectory: false, readable: false };
			}
			return { exists: false, isDirectory: false, readable: false };
		}
	}
}

import type { MediaKind } from '@mu/shared';

/**
 * Outcome of importing one file. Shared by every importer so the scan
 * orchestrator and the watcher can count/log results without knowing the kind.
 */
export type ImportFileResult =
	| { status: 'skipped-size' }
	| { status: 'skipped-duration' }
	| { status: 'updated' }
	/** `entityId` = the movie (video) / track (audio) id. `movieId` kept for video callers. */
	| { status: 'added'; entityId: string; title: string; movieId?: string }
	| { status: 'race-skipped' }
	| { status: 'error'; reason: string };

/**
 * One per media kind. `ScannerService` (the scan orchestrator) walks a source
 * with the importer registered for the source's `kind` and hands every
 * matching file to `importFile`. The watcher routes live events the same way.
 * Adding a kind = implementing this + registering it in the ImporterRegistry;
 * movie code is never touched. See docs/music-support-plan.md §3.3, §5.1.
 */
export interface MediaImporter {
	readonly kind: MediaKind;
	/** Lower-case extensions WITH the leading dot (e.g. `.mkv`). */
	readonly extensions: readonly string[];

	/** Import (or refresh) one file found under source `sourceId`. */
	importFile(sourceId: string, filePath: string): Promise<ImportFileResult>;

	/** Delete catalogue rows left with no available file. Returns how many. */
	purgeOrphans(): Promise<number>;

	/**
	 * End of a full source walk: flag this importer's files under `sourceId`
	 * that weren't seen as unavailable. Returns how many were flagged.
	 */
	markMissing(sourceId: string, foundPaths: ReadonlySet<string>): Promise<number>;

	/** Watcher: a file of this kind was deleted (source still mounted). */
	handleFileRemoved?(filePath: string): Promise<void>;

	/** Watcher: a directory under a source of this kind was deleted. */
	handleDirectoryRemoved?(dirPath: string): Promise<void>;
}

/** Normalise an extension list to lower-case, dot-prefixed form. */
export function normalizeExtensions(exts: readonly string[]): string[] {
	return exts.map((e) => {
		const lower = e.toLowerCase();
		return lower.startsWith('.') ? lower : `.${lower}`;
	});
}

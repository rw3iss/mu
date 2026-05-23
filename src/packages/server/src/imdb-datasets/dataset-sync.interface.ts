/**
 * One IMDB bulk dataset (e.g. `title.ratings`, `title.basics`,
 * `title.principals`). Each is a streaming download → parse → upsert.
 *
 * The orchestrator owns scheduling, status tracking, and the HTTP
 * surface; concrete syncs only know how to fetch + parse their own
 * file. Adding a new dataset = one class implementing this interface
 * + a registration in ImdbDatasetsModule.
 */
export interface DatasetSync {
	/** Stable identifier used in settings keys + UI labels. */
	readonly id: string;
	/** Human-readable name shown in admin status rows. */
	readonly displayName: string;
	/** URL of the gzipped TSV in IMDB's public S3 bucket. */
	readonly downloadUrl: string;
	/** Approx unpacked size in MB — shown to the admin before sync. */
	readonly approxSizeMb: number;

	/**
	 * Stream the source TSV from `downloadUrl`, gunzip on the fly,
	 * parse line-by-line, and upsert into the local table. Throws on
	 * any I/O or parse failure so the orchestrator can record it.
	 *
	 * @returns Final row count written.
	 */
	sync(): Promise<{ rowsWritten: number; durationMs: number }>;

	/** Current local row count — used by the admin status payload. */
	count(): number;
}

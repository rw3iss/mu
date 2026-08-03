export enum ScanStatus {
	RUNNING = 'running',
	COMPLETED = 'completed',
	FAILED = 'failed',
}

export enum StreamMode {
	DIRECT_PLAY = 'direct_play',
	DIRECT_STREAM = 'direct_stream',
	TRANSCODE = 'transcode',
}

export enum HwAccel {
	NONE = 'none',
	VAAPI = 'vaapi',
	NVENC = 'nvenc',
	QSV = 'qsv',
}

export enum WsEvent {
	SUBSCRIBE = 'subscribe',
	UNSUBSCRIBE = 'unsubscribe',
	PLAYER_HEARTBEAT = 'player:heartbeat',
	LIBRARY_MOVIE_ADDED = 'library:movie-added',
	LIBRARY_MOVIE_UPDATED = 'library:movie-updated',
	LIBRARY_MOVIE_REMOVED = 'library:movie-removed',
	SCAN_STARTED = 'scan:started',
	SCAN_PROGRESS = 'scan:progress',
	SCAN_COMPLETED = 'scan:completed',
	SCAN_ERROR = 'scan:error',
	STREAM_STARTED = 'stream:started',
	STREAM_ENDED = 'stream:ended',
	/**
	 * A user's watched/in-progress status for a movie changed (finished playing,
	 * marked watched/unwatched). Lets the dashboard "Continue Watching" rail and
	 * resume bars refresh live. Payload: { userId, movieId, watched }. Channel:
	 * `watch`.
	 */
	WATCH_STATUS_CHANGED = 'watch:status-changed',
	/**
	 * A movie's stream was superseded — its source changed (e.g. a background
	 * MP4 conversion replaced the original / produced a cached direct-play
	 * file, and the old HLS cache was cleared). Clients currently playing that
	 * movie should re-fetch the stream and reload the source at their current
	 * position. Payload: { movieId, fileId }.
	 */
	STREAM_SUPERSEDED = 'stream:superseded',
	PLUGIN_EVENT = 'plugin:event',
	JOB_STARTED = 'job:started',
	JOB_PROGRESS = 'job:progress',
	JOB_COMPLETED = 'job:completed',
	JOB_FAILED = 'job:failed',
	SERVER_STATUS = 'server:status',
	NOTIFICATION = 'notification',
	/**
	 * Progress of a direct library upload, emitted from the server as bytes are
	 * streamed to disk (ground-truth progress, independent of the browser's XHR
	 * upload events). Payload: { uploadId, relativePath, bytesWritten, fileTotal }.
	 * Channel: `upload`.
	 */
	UPLOAD_PROGRESS = 'upload:progress',
	/**
	 * A direct library upload finished (all files written) or failed. Lets other
	 * sessions/devices toast the result. Payload: { uploadId, sourceId, rootName,
	 * ok, error? }. Channel: `upload`.
	 */
	UPLOAD_COMPLETED = 'upload:completed',

	// ── Shared Sessions (watch party) ──
	/** A member joined a session (presence). Channel: `session:<id>`. */
	SHARED_SESSION_JOINED = 'session:joined',
	/** A member left a session (presence). Channel: `session:<id>`. */
	SHARED_SESSION_LEFT = 'session:left',
	/** Playback command relayed to the room: play|pause|seek|heartbeat. */
	SHARED_SESSION_COMMAND = 'session:command',
	/** A chat message relayed to the room. */
	SHARED_SESSION_CHAT = 'session:chat',
	/** WebRTC signaling (offer|answer|ice), targeted to a specific `user:<id>`. */
	SHARED_SESSION_SIGNAL = 'session:signal',
	/** Session settings changed (admin). Channel: `session:<id>`. */
	SHARED_SESSION_SETTINGS = 'session:settings',
	/** Admin transferred to another member. Channel: `session:<id>`. */
	SHARED_SESSION_ADMIN = 'session:admin',
	/** Session ended by the admin. Channel: `session:<id>`. */
	SHARED_SESSION_ENDED = 'session:ended',
	/** Roster + per-member voice/mute/ready state. Channel: `session:<id>`. */
	SHARED_SESSION_PRESENCE = 'session:presence',
}

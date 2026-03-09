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
	PLUGIN_EVENT = 'plugin:event',
	JOB_STARTED = 'job:started',
	JOB_PROGRESS = 'job:progress',
	JOB_COMPLETED = 'job:completed',
	JOB_FAILED = 'job:failed',
	SERVER_STATUS = 'server:status',
	NOTIFICATION = 'notification',
}

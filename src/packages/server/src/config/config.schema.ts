import { z } from 'zod';

export const configSchema = z.object({
	server: z
		.object({
			host: z.string().default('0.0.0.0'),
			port: z.coerce.number().int().min(1).max(65535).default(4000),
			cors: z
				.object({
					origin: z.union([z.string(), z.array(z.string()), z.boolean()]).default(true),
					credentials: z.boolean().default(true),
				})
				.default(() => ({}) as any),
			rateLimit: z
				.object({
					max: z.coerce.number().int().positive().default(100),
					windowMs: z.coerce.number().int().positive().default(60_000),
				})
				.default(() => ({}) as any),
			logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
		})
		.default(() => ({}) as any),

	database: z
		.object({
			path: z.string().default('./data/db/mu.db'),
			walMode: z.boolean().default(true),
			busyTimeout: z.coerce.number().int().nonnegative().default(5000),
		})
		.default(() => ({}) as any),

	cache: z
		.object({
			maxSize: z.coerce.number().int().positive().default(500),
			ttlSeconds: z.coerce.number().int().positive().default(3600),
			/**
			 * Cache root. When set (env `MU_CACHE_DIR` or `cache.dir` in
			 * config.yml), every cache subdir (streams, images, sprites,
			 * subtitles, hot) anchors under it — point this at a fast SSD/NVMe
			 * to keep transient cache + staged movies off a slow media HDD.
			 * Empty → `<dataDir>/cache`.
			 */
			dir: z.string().default(''),
			imageDir: z.string().default('./data/cache/images'),
			streamDir: z.string().default('./data/cache/streams'),
			/** Resolved at load time from the cache root; usually leave empty. */
			subtitleDir: z.string().default(''),
			persistTranscodes: z.boolean().default(true),
			/**
			 * NVMe "hot" cache: pre-stage the full source file of a movie to a
			 * fast drive on play-start so playback (and concurrent streams) stop
			 * thrashing the media HDD. LRU + age eviction keeps it bounded.
			 */
			hot: z
				.object({
					enabled: z.boolean().default(false),
					/** Override the staged-file dir. Empty → `<cacheRoot>/hot`. */
					dir: z.string().default(''),
					/** Max total size of staged files before LRU eviction (GB). */
					maxGb: z.coerce.number().nonnegative().default(300),
					/** Evict a fully-watched movie this many hours after last access. */
					watchedTtlHours: z.coerce.number().positive().default(24),
					/** Evict a not-fully-watched movie this many hours after staging. */
					unwatchedTtlHours: z.coerce.number().positive().default(48),
					/** Hard idle cap: evict anything untouched this many hours. */
					idleTtlHours: z.coerce.number().positive().default(168),
					/**
					 * Only stage files whose path starts with one of these prefixes
					 * (the slow drives, e.g. `["D:"]`). Empty → auto-detect HDDs on
					 * Windows; otherwise stage from any non-cache drive.
					 */
					slowDrives: z.array(z.string()).default([]),
				})
				.default(() => ({}) as any),
		})
		.default(() => ({}) as any),

	logs: z
		.object({
			/**
			 * Directory containing server log files. Defaults to
			 * `<dataDir>/logs`. Override on platforms where the supervisor
			 * (NSSM, systemd, …) writes logs to a fixed path that doesn't
			 * follow dataDir — set MU_LOGS_DIR or `logs.dir` in config.yml.
			 */
			dir: z.string().default(''),
		})
		.default(() => ({}) as any),

	uploads: z
		.object({
			/**
			 * Public uploads root — user-provided files served verbatim at
			 * `/uploads/*` (avatars now; chat/comment media later). Empty →
			 * `<dataDir>/uploads`. Each kind lives in its own subdir
			 * (`avatars/`, …). Keep this OFF a slow media HDD if possible.
			 */
			dir: z.string().default(''),
		})
		.default(() => ({}) as any),

	auth: z.object({
		jwtSecret: z.string().min(32),
		jwtExpiresIn: z.string().default('7d'),
		cookieSecret: z.string().min(32),
		cookieMaxAgeMs: z.coerce
			.number()
			.int()
			.positive()
			.default(7 * 24 * 60 * 60 * 1000),
		bcryptRounds: z.coerce.number().int().min(4).max(31).default(12),
		// NOTE: self-registration is deliberately NOT configured here. It's an
		// admin setting (Settings → Users), stored in the settings table and
		// read by RegistrationService. A dead `allowRegistration` key used to
		// live here — nothing read it, and its `true` default contradicted the
		// real feature's off-by-default, so it was removed.
		/**
		 * Opaque token consumed by unattended internal services
		 * (e.g. the scheduled-debugger remote routine) to hit
		 * `/admin/logs/*`. Empty disables the endpoint entirely.
		 */
		apiToken: z.string().default(''),
	}),

	media: z
		.object({
			libraryPaths: z.array(z.string()).default([]),
			scanIntervalMinutes: z.coerce.number().int().positive().default(60),
			thumbnailDir: z.string().default('./data/thumbnails'),
			thumbnailWidth: z.coerce.number().int().positive().default(640),
			thumbnailHeight: z.coerce.number().int().positive().default(360),
			supportedExtensions: z
				.array(z.string())
				.default(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts']),
			watchForChanges: z.boolean().default(true),
		})
		.default(() => ({}) as any),

	transcoding: z
		.object({
			enabled: z.boolean().default(true),
			ffmpegPath: z.string().default('ffmpeg'),
			ffprobePath: z.string().default('ffprobe'),
			hwAccel: z.enum(['none', 'vaapi', 'nvenc', 'qsv', 'videotoolbox']).default('none'),
			maxConcurrentJobs: z.coerce.number().int().positive().default(2),
			defaultVideoCodec: z.string().default('libx264'),
			defaultAudioCodec: z.string().default('aac'),
			presets: z
				.record(
					z.string(),
					z.object({
						videoCodec: z.string().optional(),
						audioCodec: z.string().optional(),
						videoBitrate: z.string().optional(),
						audioBitrate: z.string().optional(),
						resolution: z.string().optional(),
					}),
				)
				.default({
					'720p': { videoBitrate: '2500k', audioBitrate: '128k', resolution: '1280x720' },
					'1080p': {
						videoBitrate: '5000k',
						audioBitrate: '192k',
						resolution: '1920x1080',
					},
				}),
		})
		.default(() => ({}) as any),

	thirdParty: z
		.object({
			tmdb: z
				.object({
					apiKey: z.string().default(''),
					baseUrl: z.string().url().default('https://api.themoviedb.org/3'),
					language: z.string().default('en-US'),
				})
				.default(() => ({}) as any),
			omdb: z
				.object({
					apiKey: z.string().default(''),
					baseUrl: z.string().url().default('https://www.omdbapi.com'),
				})
				.default(() => ({}) as any),
			opensubtitles: z
				.object({
					apiKey: z.string().default(''),
				})
				.default(() => ({}) as any),
		})
		.default(() => ({}) as any),

	ratings: z
		.object({
			enabled: z.boolean().default(true),
			allowPublicAccess: z.boolean().default(false),
			maxRating: z.coerce.number().int().positive().default(10),
		})
		.default(() => ({}) as any),

	plugins: z
		.object({
			enabled: z.boolean().default(false),
			directory: z.string().default('./plugins'),
			allowedPlugins: z.array(z.string()).default([]),
		})
		.default(() => ({}) as any),

	tls: z
		.object({
			hostname: z.string().default(''),
			certPath: z.string().default(''),
			keyPath: z.string().default(''),
		})
		.default(() => ({}) as any),

	/**
	 * Outbound email (currently: admin feedback notifications). Disabled by
	 * default — a no-op stub until a provider + admin address are configured.
	 * Lives in config.yml (runtime, not committed); the Brevo API key is a secret
	 * the self-host operator supplies there.
	 */
	email: z
		.object({
			enabled: z.boolean().default(false),
			provider: z.enum(['brevo', 'resend', 'smtp']).default('brevo'),
			/** Verified sender on your domain, e.g. `mu@ryanweiss.net`. */
			fromAddress: z.string().default('noreply@mu.local'),
			fromName: z.string().default('Mu'),
			/** Where recipient replies land (e.g. ryan@ryanweiss.net). */
			replyTo: z.string().default(''),
			/** Where admin notifications (e.g. new feedback) are sent. */
			adminEmail: z.string().default(''),
			/** Brevo (https://www.brevo.com) transactional email API key. */
			brevoApiKey: z.string().default(''),
			/** Resend (https://resend.com) transactional email API key. */
			resendApiKey: z.string().default(''),
			/** Public web URL for email footer links. Empty → derived from the
			 *  page the feedback was sent from, else https://<tls.hostname>. */
			siteUrl: z.string().default(''),
		})
		.default(() => ({}) as any),

	/**
	 * Self-hosted coTURN for Shared Sessions (watch-party) WebRTC voice.
	 * Disabled by default — voice still works for same-LAN / friendly-NAT peers
	 * via STUN, and clients always get the public Google STUN fallback. When
	 * enabled, `GET /shared-sessions/ice-config` returns TURN with short-lived
	 * HMAC credentials (coTURN `use-auth-secret`). Set up via
	 * `scripts/coturn-setup.sh`. Secrets live in config.yml (not committed).
	 */
	turn: z
		.object({
			enabled: z.boolean().default(false),
			/** Public host/IP peers reach coTURN at (also the advertised relay). */
			publicHost: z.string().default(''),
			/** coTURN `static-auth-secret` — shared HMAC secret (runtime secret). */
			secret: z.string().default(''),
			/** coTURN realm (e.g. the public host). */
			realm: z.string().default(''),
			/** Bounded UDP relay port range, e.g. `49160-49200`. */
			relayPortRange: z.string().default('49160-49200'),
			/** Extra STUN URLs to advertise, ahead of the public fallback. */
			stunUrls: z.array(z.string()).default([]),
		})
		.default(() => ({}) as any),

	/**
	 * Background-job backend. `JobModule` / `worker.ts` read these keys, but the
	 * block was missing from this schema — and zod strips unknown keys, so a
	 * `jobs:` section in config.yml was silently discarded and `jobs.backend`
	 * always fell back to `in-memory`. That made the fully-implemented BullMQ
	 * provider impossible to enable via config. Defaults below mirror the
	 * fallbacks the code already passes to `config.get`.
	 */
	jobs: z
		.object({
			backend: z.enum(['in-memory', 'bullmq']).default('in-memory'),
			redis: z
				.object({
					url: z.string().default('redis://localhost:6379'),
				})
				.default(() => ({}) as any),
			bullmq: z
				.object({
					queueName: z.string().default('mu-jobs'),
					concurrency: z.coerce.number().int().positive().default(2),
				})
				.default(() => ({}) as any),
		})
		.default(() => ({}) as any),

	dataDir: z.string().default('../../data'),
});

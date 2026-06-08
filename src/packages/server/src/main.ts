import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';
import { SeoService } from './seo/seo.service.js';

// Load .env file if present (no external dependency needed).
// Searches: src/.env, project root .env, server package .env
for (const envPath of [
	resolve(import.meta.dirname, '..', '..', '..', '.env'),
	resolve(import.meta.dirname, '..', '..', '..', '..', '.env'),
	resolve(import.meta.dirname, '..', '.env'),
]) {
	if (existsSync(envPath)) {
		const lines = readFileSync(envPath, 'utf-8').split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx < 1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			let val = trimmed.slice(eqIdx + 1).trim();
			// Remove surrounding quotes
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			// Don't override existing env vars (NSSM/system vars take precedence)
			if (!(key in process.env)) {
				process.env[key] = val;
			}
		}
		break; // only load the first .env found
	}
}

/**
 * Try to load TLS cert/key from well-known paths.
 * Priority: config tls.certPath/tls.keyPath > Let's Encrypt live dir.
 */
function loadTlsCredentials(
	config: ConfigService,
	logger: Logger,
): { cert: Buffer; key: Buffer } | null {
	const certPath = config.get<string | undefined>('tls.certPath');
	const keyPath = config.get<string | undefined>('tls.keyPath');

	// Explicit config paths
	if (certPath && keyPath) {
		const certExists = existsSync(certPath);
		const keyExists = existsSync(keyPath);
		if (certExists && keyExists) {
			try {
				const cred = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
				logger.log(`TLS: using certs from config (${certPath})`);
				return cred;
			} catch (err: any) {
				// e.g. a Certbot symlink swap mid-read — caller retries.
				logger.warn(
					`TLS: config certs present but unreadable (${certPath}): ${err.message}`,
				);
				return null;
			}
		}
		logger.warn(
			`TLS: config has certPath/keyPath but files not found (cert=${certExists}, key=${keyExists}): ${certPath}`,
		);
	}

	// Auto-detect Let's Encrypt on the current host
	const hostname = config.get<string>('tls.hostname', '');
	logger.log(
		`TLS: hostname=${hostname || '(not set)'}, certPath=${certPath || '(not set)'}, keyPath=${keyPath || '(not set)'}`,
	);
	const searchDirs = hostname
		? [
				// Windows certbot
				`C:/Certbot/live/${hostname}`,
				// Linux certbot
				`/etc/letsencrypt/live/${hostname}`,
			]
		: [];

	for (const dir of searchDirs) {
		const fullchain = join(dir, 'fullchain.pem');
		const privkey = join(dir, 'privkey.pem');
		if (existsSync(fullchain) && existsSync(privkey)) {
			try {
				const cred = { cert: readFileSync(fullchain), key: readFileSync(privkey) };
				logger.log(`TLS: using Let's Encrypt certs from ${dir}`);
				return cred;
			} catch (err: any) {
				logger.warn(
					`TLS: Let's Encrypt certs present but unreadable in ${dir}: ${err.message}`,
				);
				return null;
			}
		}
	}

	return null;
}

/**
 * True when TLS certs are *expected* (configured via certPath/keyPath or a
 * hostname). Used to refuse a silent plain-HTTP fallback — clients hitting
 * https:// would otherwise fail to connect with no obvious cause.
 */
function isTlsExpected(config: ConfigService): boolean {
	const certPath = config.get<string | undefined>('tls.certPath');
	const keyPath = config.get<string | undefined>('tls.keyPath');
	const hostname = config.get<string>('tls.hostname', '');
	return Boolean((certPath && keyPath) || hostname);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kill any stale process LISTENING on `port` so a restart can rebind cleanly.
 * On Windows only node.exe holders are killed (never an unrelated service that
 * happens to hold the port).
 */
function reclaimPort(port: number, logger: Logger): void {
	try {
		if (process.platform === 'win32') {
			const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
			const pids = new Set<string>();
			for (const line of out.split('\n')) {
				if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
					const pid = line.trim().split(/\s+/).pop();
					if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
				}
			}
			for (const pid of pids) {
				let image = '';
				try {
					image = execSync(`tasklist /FI "PID eq ${pid}" /FO csv /NH`, {
						encoding: 'utf8',
					});
				} catch {}
				if (!/node\.exe/i.test(image)) {
					logger.warn(`Port ${port} held by non-node PID ${pid} — leaving it alone.`);
					continue;
				}
				logger.warn(`Killing stale node PID ${pid} holding port ${port}`);
				try {
					execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
				} catch {}
			}
		} else {
			try {
				execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
			} catch {
				try {
					execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'ignore' });
				} catch {}
			}
		}
	} catch (err: any) {
		logger.warn(`reclaimPort(${port}) failed: ${err.message}`);
	}
}

/** Bind the HTTP server, reclaiming the port from a stale instance on EADDRINUSE. */
async function listenWithReclaim(
	app: NestFastifyApplication,
	port: number,
	host: string,
	logger: Logger,
): Promise<void> {
	try {
		await app.listen(port, host);
	} catch (err: any) {
		if (err?.code !== 'EADDRINUSE') throw err;
		logger.warn(`Port ${port} in use — reclaiming from a stale instance...`);
		reclaimPort(port, logger);
		await delay(1500);
		await app.listen(port, host);
		logger.log(`Reclaimed port ${port} and bound successfully.`);
	}
}

async function bootstrap() {
	const preConfig = new ConfigService();
	const bootstrapLogger = new Logger('Bootstrap');
	let tls = loadTlsCredentials(preConfig, bootstrapLogger);
	// If TLS is configured but the certs momentarily can't be read (e.g. a
	// Certbot symlink swap), retry before giving up. Never silently serve plain
	// HTTP when HTTPS is expected — that leaves the site unreachable with no
	// obvious cause. Exit instead so the launcher / scheduled task restarts us.
	if (!tls && isTlsExpected(preConfig)) {
		for (let attempt = 1; attempt <= 5 && !tls; attempt++) {
			bootstrapLogger.warn(
				`TLS is configured but certs not loaded — retry ${attempt}/5 in 1s (transient cert/symlink state?)`,
			);
			await delay(1000);
			tls = loadTlsCredentials(preConfig, bootstrapLogger);
		}
		if (!tls) {
			bootstrapLogger.error(
				'FATAL: TLS is configured but certificates could not be loaded after 5 retries. ' +
					'Refusing to start in plain HTTP (clients expect HTTPS). Exiting so the launcher can retry.',
			);
			process.exit(1);
		}
	}

	const httpsOptions = tls ? { https: { cert: tls.cert, key: tls.key } } : {};

	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter({
			...httpsOptions,
			logger: {
				level: process.env.MU_SERVER_LOG_LEVEL ?? 'info',
				transport:
					process.env.NODE_ENV !== 'production'
						? { target: 'pino-pretty', options: { colorize: true } }
						: undefined,
			},
			trustProxy: true,
			// Fastify's router defaults to 100 chars per :param. Share-link
			// tokens (JWTs) are ~200+ chars; without this they silently 404.
			// Allow up to 4 KB so any future long-id routes (UUIDs, tokens)
			// also work without surprise.
			maxParamLength: 4096,
		}),
	);

	const config = app.get(ConfigService);
	const logger = new Logger('Bootstrap');

	// WebSocket adapter
	app.useWebSocketAdapter(new WsAdapter(app));

	// Register Fastify plugins on the underlying instance
	const fastify = app.getHttpAdapter().getInstance();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify plugin type augmentations conflict with NestJS's typed instance
	const register = fastify.register.bind(fastify) as unknown as (...args: any[]) => Promise<void>;

	await register(fastifyCors, {
		origin: config.get<string | boolean | string[]>('server.corsOrigins', true),
		credentials: true,
	});

	await register(fastifyCookie, {
		secret: config.get<string>('auth.cookieSecret'),
	});

	await register(fastifyJwt, {
		secret: config.get<string>('auth.jwtSecret'),
		cookie: { cookieName: 'mu_access_token', signed: false },
	});

	await register(fastifyMultipart, {
		limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max subtitle file
	});

	// Rate limiting disabled for now
	// await register(fastifyRateLimit, {
	//   max: 100,
	//   timeWindow: '1 minute',
	//   allowList: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
	// });

	// Serve client static files + SPA fallback
	const clientDist = join(import.meta.dirname, '..', '..', 'client', 'dist');
	if (existsSync(clientDist)) {
		await register(fastifyStatic, {
			root: clientDist,
			prefix: '/',
			decorateReply: false,
		});

		// SPA fallback: intercept 404 responses for non-API routes and serve index.html.
		// Read from disk each time so rebuilds are picked up without server restart.
		// Per-route SEO meta is injected by SeoService before the HTML ships, so
		// crawlers and social-media bots see the right title / og:image / og:description
		// even though the page itself is client-rendered.
		const indexHtmlPath = join(clientDist, 'index.html');
		const seoService = app.get(SeoService);
		// SEO injection: catches BOTH SPA-fallback 404s (deep routes like
		// /movie/abc) AND fastify-static's auto-served index.html for `/`
		// and other directory hits. We detect the latter by looking at
		// the response Content-Type — any text/html response on a non-API
		// GET path runs through the injector.
		fastify.addHook('onSend', async (request, reply, payload) => {
			if (request.method !== 'GET' || request.url.startsWith('/api/')) {
				return payload;
			}
			const url = request.url.split('?')[0] ?? '/';
			const forwardedProto = request.headers['x-forwarded-proto'] as string | undefined;
			const forwardedHost =
				(request.headers['x-forwarded-host'] as string | undefined) ??
				(request.headers.host as string | undefined);
			const proto = forwardedProto ?? (request.protocol as string) ?? 'http';
			const origin = forwardedHost ? `${proto}://${forwardedHost}` : undefined;

			// Case A: SPA fallback for unknown routes (404).
			if (reply.statusCode === 404) {
				try {
					const rawHtml = readFileSync(indexHtmlPath, 'utf-8');
					const html = await seoService.renderForUrl(
						url,
						rawHtml,
						request.server,
						origin,
					);
					reply.status(200).header('Content-Type', 'text/html; charset=utf-8');
					return html;
				} catch {
					return payload;
				}
			}

			// Case B: fastify-static served the file (e.g. `/` → index.html).
			// Read it from disk so we have the source to inject into.
			const contentType = (reply.getHeader('content-type') as string | undefined) ?? '';
			if (reply.statusCode === 200 && contentType.startsWith('text/html')) {
				try {
					const rawHtml = readFileSync(indexHtmlPath, 'utf-8');
					const html = await seoService.renderForUrl(
						url,
						rawHtml,
						request.server,
						origin,
					);
					reply.header('Content-Type', 'text/html; charset=utf-8');
					return html;
				} catch {
					return payload;
				}
			}
			return payload;
		});
	}

	// Global API prefix — exclude health check only
	app.setGlobalPrefix('api/v1', {
		exclude: ['health'],
	});

	// Bounded shutdown. Nest's enableShutdownHooks() registers SIGTERM/SIGINT
	// handlers that call app.close() — but close() can hang indefinitely here:
	// long-lived handles (the toad-scheduler, chokidar watchers, ffmpeg stdio
	// pipes, the WS server) keep the event loop alive, so the process never
	// exits. systemd then waits out its TimeoutStopSec, SIGABRTs, waits again,
	// and finally SIGKILLs — ~90s of dead air on every deploy. Instead we run the
	// lifecycle hooks via close() but force-exit after a short grace window so a
	// restart frees port 4000 in seconds. SQLite (WAL) is crash-safe, so a hard
	// exit mid-shutdown can't corrupt the DB.
	const SHUTDOWN_GRACE_MS = Number(process.env.MU_SHUTDOWN_GRACE_MS) || 5000;
	let shuttingDown = false;
	const shutdown = (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.log(`${signal} received — shutting down (force-exit in ${SHUTDOWN_GRACE_MS}ms)`);
		const forceExit = setTimeout(() => {
			logger.warn('Graceful shutdown exceeded grace window — forcing exit.');
			process.exit(0);
		}, SHUTDOWN_GRACE_MS);
		forceExit.unref();
		app.close()
			.then(() => {
				clearTimeout(forceExit);
				process.exit(0);
			})
			.catch((err) => {
				logger.error(`Error during shutdown: ${err?.message ?? err}`);
				clearTimeout(forceExit);
				process.exit(0);
			});
	};
	process.once('SIGTERM', () => shutdown('SIGTERM'));
	process.once('SIGINT', () => shutdown('SIGINT'));

	const host = config.get<string>('server.host', '0.0.0.0');
	const port = config.get<number>('server.port', 4000);

	await listenWithReclaim(app, port, host, logger);
	const proto = tls ? 'https' : 'http';
	logger.log(`Mu server v0.1.0 running at ${proto}://${host}:${port}`);

	// When TLS is active, start a tiny HTTP server that redirects to HTTPS.
	if (tls) {
		const httpPort = config.get<number>('server.httpRedirectPort', 80);
		const httpServer = http.createServer((req, res) => {
			const location = `https://${req.headers.host?.replace(`:${httpPort}`, `:${port}`) ?? `localhost:${port}`}${req.url}`;
			res.writeHead(301, { Location: location });
			res.end();
		});
		httpServer.on('error', (err: any) => {
			logger.warn(`Could not start HTTP redirect on port ${httpPort}: ${err.message}`);
		});
		httpServer.listen(httpPort, host, () => {
			logger.log(`HTTP→HTTPS redirect listening on ${host}:${httpPort}`);
		});
	}
}

bootstrap().catch((err) => {
	console.error('Failed to start Mu server:', err);
	process.exit(1);
});

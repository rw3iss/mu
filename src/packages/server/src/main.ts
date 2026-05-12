import 'reflect-metadata';
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
			logger.log(`TLS: using certs from config (${certPath})`);
			return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
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
			logger.log(`TLS: using Let's Encrypt certs from ${dir}`);
			return { cert: readFileSync(fullchain), key: readFileSync(privkey) };
		}
	}

	return null;
}

async function bootstrap() {
	const preConfig = new ConfigService();
	const bootstrapLogger = new Logger('Bootstrap');
	const tls = loadTlsCredentials(preConfig, bootstrapLogger);

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

		// SPA fallback: intercept 404 responses for non-API routes and serve index.html
		// Read from disk each time so rebuilds are picked up without server restart
		const indexHtmlPath = join(clientDist, 'index.html');
		fastify.addHook('onSend', (request, reply, payload, done) => {
			if (
				reply.statusCode === 404 &&
				request.method === 'GET' &&
				!request.url.startsWith('/api/')
			) {
				try {
					const html = readFileSync(indexHtmlPath);
					reply.status(200).header('Content-Type', 'text/html');
					done(null, html);
				} catch {
					done(null, payload);
				}
			} else {
				done(null, payload);
			}
		});
	}

	// Global API prefix — exclude health check only
	app.setGlobalPrefix('api/v1', {
		exclude: ['health'],
	});

	app.enableShutdownHooks();

	const host = config.get<string>('server.host', '0.0.0.0');
	const port = config.get<number>('server.port', 4000);

	await app.listen(port, host);
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

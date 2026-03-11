import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap() {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter({
			logger: {
				level: process.env.MU_SERVER_LOG_LEVEL ?? 'info',
				transport:
					process.env.NODE_ENV !== 'production'
						? { target: 'pino-pretty', options: { colorize: true } }
						: undefined,
			},
			trustProxy: true,
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
	logger.log(`Mu server v0.1.0 running at http://${host}:${port}`);
}

bootstrap().catch((err) => {
	console.error('Failed to start Mu server:', err);
	process.exit(1);
});

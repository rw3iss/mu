import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { watch } from 'chokidar';
import { defineConfig, type Plugin } from 'vite';

const clientSrc = resolve(__dirname, 'src');
const workspaceRoot = resolve(__dirname, '../..');
const pluginsDir = resolve(workspaceRoot, 'plugins');

/**
 * Vite plugin that watches plugin client directories outside the project root.
 *
 * In dev mode (vite dev server on port 3000): restarts the server so the
 * module graph is rebuilt and the browser gets fresh plugin code.
 *
 * Note: If you access the app through the NestJS server (port 4000) instead
 * of Vite's dev server (port 3000), the NestJS server serves pre-built files
 * from dist/. In that case you need to run `pnpm build` (or use port 3000).
 */
function watchPluginClients(): Plugin {
	return {
		name: 'watch-plugin-clients',
		configureServer(server) {
			const watcher = watch(pluginsDir, {
				ignoreInitial: true,
				awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
			});

			function handlePluginChange(path: string, event: string) {
				if (!path.includes('/client/')) return;
				server.config.logger.info(
					`\x1b[35m[plugins]\x1b[0m ${path.replace(workspaceRoot + '/', '')} ${event}, restarting...`,
					{ timestamp: true },
				);
				server.restart();
			}

			watcher.on('change', (path) => handlePluginChange(path, 'changed'));
			watcher.on('add', (path) => handlePluginChange(path, 'added'));

			server.httpServer?.on('close', () => watcher.close());
		},
	};
}

export default defineConfig({
	plugins: [preact(), watchPluginClients()],
	resolve: {
		alias: {
			'@': clientSrc,
			'@mu/shared': resolve(__dirname, '../shared/src'),
		},
	},
	css: {
		preprocessorOptions: {
			scss: {
				additionalData: `@use "${resolve(clientSrc, 'styles/_variables.scss').replace(/\\/g, '/')}" as *; @use "${resolve(clientSrc, 'styles/_mixins.scss').replace(/\\/g, '/')}" as *;`,
			},
		},
		modules: { localsConvention: 'camelCase' },
	},
	build: { outDir: 'dist', sourcemap: true },
	server: {
		port: 3000,
		fs: {
			allow: [workspaceRoot],
		},
		proxy: {
			'/api': 'http://localhost:4000',
			'/ws': { target: 'ws://localhost:4000', ws: true },
		},
	},
});

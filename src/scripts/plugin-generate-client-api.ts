#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pluginId = process.argv[2];

if (!pluginId) {
	console.error('Usage: pnpm plugin:generate-client-api <plugin-id>');
	console.error('Example: pnpm plugin:generate-client-api example-info');
	process.exit(1);
}

const pluginsDir = resolve(import.meta.dirname, '..', 'plugins');
const pluginDir = join(pluginsDir, pluginId);

if (!existsSync(pluginDir)) {
	console.error(`Error: Plugin directory not found: ${pluginDir}`);
	process.exit(1);
}

// Convert plugin-id to PascalCase
const pascalCase = pluginId
	.split('-')
	.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
	.join('');

const port = process.env.PORT || '3000';
const schemaUrl = `http://localhost:${port}/api/v1/plugins/${pluginId}/schema`;

console.log(`Fetching schema from ${schemaUrl}...`);

interface EndpointSchema {
	methodName: string;
	method: string;
	path: string;
	schema?: {
		params?: Record<string, 'string' | 'number'>;
		query?: Record<string, 'string' | 'number'>;
		body?: Record<string, unknown>;
		response?: Record<string, unknown>;
	};
}

interface PluginSchema {
	pluginName: string;
	basePath: string;
	endpoints: EndpointSchema[];
}

async function main() {
	let schema: PluginSchema;

	try {
		const response = await fetch(schemaUrl);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		schema = (await response.json()) as PluginSchema;
	} catch (err) {
		console.error('');
		console.error(`Failed to fetch schema from ${schemaUrl}`);
		console.error(err instanceof Error ? err.message : String(err));
		console.error('');
		console.error('Make sure the server is running:');
		console.error('  pnpm dev:server');
		console.error('');
		console.error(`And that the "${pluginId}" plugin is enabled.`);
		process.exit(1);
	}

	if (!schema.endpoints || schema.endpoints.length === 0) {
		console.log(`Plugin "${pluginId}" has no registered endpoints. Nothing to generate.`);
		process.exit(0);
	}

	// Generate client API
	const clientDir = join(pluginDir, 'client');
	mkdirSync(clientDir, { recursive: true });

	const methods = schema.endpoints.map((ep) => {
		const paramNames = ep.schema?.params ? Object.keys(ep.schema.params) : [];
		const queryNames = ep.schema?.query ? Object.keys(ep.schema.query) : [];
		const hasBody = ep.method === 'POST' || ep.method === 'PUT';

		// Build function params
		const fnParams: string[] = [];
		for (const p of paramNames) {
			const type = ep.schema?.params?.[p] === 'number' ? 'number' : 'string';
			fnParams.push(`${p}: ${type}`);
		}
		if (queryNames.length > 0) {
			const queryType = queryNames
				.map((q) => {
					const type = ep.schema?.query?.[q] === 'number' ? 'number' : 'string';
					return `${q}?: ${type}`;
				})
				.join('; ');
			fnParams.push(`query?: { ${queryType} }`);
		}
		if (hasBody) {
			fnParams.push('body?: unknown');
		}

		// Build the path with interpolation
		let pathExpr = ep.path;
		for (const p of paramNames) {
			pathExpr = pathExpr.replace(`:${p}`, `\${${p}}`);
		}

		// Build the method call
		const httpMethod = ep.method.toLowerCase();
		const apiPath = `/plugins/${pluginId}/api${pathExpr}`;

		let methodCall: string;
		if (httpMethod === 'get' || httpMethod === 'delete') {
			if (queryNames.length > 0) {
				methodCall = `return api.${httpMethod}(\`${apiPath}\`, query as Record<string, string>);`;
			} else {
				methodCall = `return api.${httpMethod}(\`${apiPath}\`);`;
			}
		} else {
			methodCall = `return api.${httpMethod}(\`${apiPath}\`, body);`;
		}

		return `\tasync ${ep.methodName}(${fnParams.join(', ')}): Promise<unknown> {\n\t\t${methodCall}\n\t}`;
	});

	const output = `// Auto-generated client API for ${pluginId}
// Generated from schema at ${schemaUrl}
// Run \`pnpm plugin:generate-client-api ${pluginId}\` to regenerate

import { api } from '../../../packages/client/src/services/api';

export class ${pascalCase}Api {
${methods.join('\n\n')}
}
`;

	const outputPath = join(clientDir, `${pluginId}-api.ts`);
	writeFileSync(outputPath, output);

	console.log(`Client API generated at: ${outputPath}`);
	console.log(`  ${schema.endpoints.length} endpoint(s) generated`);
}

main();

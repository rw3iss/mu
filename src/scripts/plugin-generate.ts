#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const pluginId = process.argv[2];

if (!pluginId) {
  console.error('Usage: pnpm plugin:generate <plugin-id>');
  console.error('Example: pnpm plugin:generate my-awesome-plugin');
  process.exit(1);
}

// Validate plugin ID
if (!/^[a-z][a-z0-9-]*$/.test(pluginId)) {
  console.error('Error: Plugin ID must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens.');
  process.exit(1);
}

const pluginsDir = resolve(import.meta.dirname, '..', 'plugins');
const pluginDir = join(pluginsDir, pluginId);

if (existsSync(pluginDir)) {
  console.error(`Error: Plugin directory already exists: ${pluginDir}`);
  process.exit(1);
}

// Convert plugin-id to PascalCase
const pascalCase = pluginId
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join('');

// Create directories
mkdirSync(pluginDir, { recursive: true });
mkdirSync(join(pluginDir, 'client'), { recursive: true });

// manifest.json
writeFileSync(
  join(pluginDir, 'manifest.json'),
  JSON.stringify(
    {
      name: pluginId,
      displayName: pascalCase.replace(/([A-Z])/g, ' $1').trim(),
      version: '0.1.0',
      description: `${pascalCase} plugin`,
      author: 'Mu',
      entryPoint: 'index.ts',
      permissions: ['read:movies'],
    },
    null,
    2,
  ) + '\n',
);

// package.json
writeFileSync(
  join(pluginDir, 'package.json'),
  JSON.stringify(
    {
      name: `@mu/plugin-${pluginId}`,
      version: '0.1.0',
      description: `${pascalCase} plugin`,
      type: 'module',
      main: 'index.ts',
    },
    null,
    2,
  ) + '\n',
);

// index.ts
writeFileSync(
  join(pluginDir, 'index.ts'),
  `import type { PluginContext, PluginInfo } from '../../packages/server/src/plugins/plugin.interface.js';

export default class ${pascalCase}Plugin {
  private context!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.context = context;

    // Register API endpoints
    context.api.registerEndpoint({
      methodName: 'getExample',
      method: 'GET',
      path: '/example',
      handler: async ({ query }) => {
        return { message: 'Hello from ${pascalCase}!', query };
      },
      schema: {
        response: { message: {} },
      },
    });

    // Register UI slot items
    context.ui.registerSlotItem('INFO_PANEL', {
      id: '${pluginId}-info',
      priority: 100,
      content: [
        { type: 'heading', text: '${pascalCase.replace(/([A-Z])/g, ' $1').trim()}' },
        { type: 'text', text: 'Content from the ${pluginId} plugin.' },
      ],
    });

    context.logger.log('${pascalCase} plugin loaded');
  }

  async onUnload(): Promise<void> {
    this.context.logger.log('${pascalCase} plugin unloaded');
  }

  getInfo(): PluginInfo {
    return {
      name: '${pluginId}',
      displayName: '${pascalCase.replace(/([A-Z])/g, ' $1').trim()}',
      version: '0.1.0',
      description: '${pascalCase} plugin',
      author: 'Mu',
      enabled: true,
      loaded: true,
      status: 'enabled',
      permissions: ['read:movies'],
    };
  }

  async onInstall(context: PluginContext): Promise<void> {
    context.logger.log('${pascalCase} plugin installed');
  }

  async onUninstall(context: PluginContext): Promise<void> {
    context.logger.log('${pascalCase} plugin uninstalled');
  }

  async onEnable(context: PluginContext): Promise<void> {
    context.logger.log('${pascalCase} plugin enabled');
  }

  async onDisable(context: PluginContext): Promise<void> {
    context.logger.log('${pascalCase} plugin disabled');
  }
}
`,
);

// client stub files
writeFileSync(
  join(pluginDir, 'client', `${pluginId}-api.ts`),
  `// Auto-generated client API for ${pluginId}
// Run \`pnpm plugin:generate-client-api ${pluginId}\` to regenerate from schema

export class ${pascalCase}Api {
  // TODO: Generated methods will go here
}
`,
);

writeFileSync(
  join(pluginDir, 'client', `${pluginId}-client.ts`),
  `// Client integration for ${pluginId}
import { ${pascalCase}Api } from './${pluginId}-api.js';

export class ${pascalCase}Client {
  private api = new ${pascalCase}Api();
}
`,
);

console.log(`Plugin scaffolded successfully at: ${pluginDir}`);
console.log('');
console.log('Files created:');
console.log(`  ${pluginDir}/manifest.json`);
console.log(`  ${pluginDir}/package.json`);
console.log(`  ${pluginDir}/index.ts`);
console.log(`  ${pluginDir}/client/${pluginId}-api.ts`);
console.log(`  ${pluginDir}/client/${pluginId}-client.ts`);
console.log('');
console.log('Next steps:');
console.log('  1. Edit index.ts to add your plugin logic');
console.log('  2. Enable the plugin via the admin UI or API');
console.log(`  3. Run \`pnpm plugin:generate-client-api ${pluginId}\` to generate the client API`);

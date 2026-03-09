import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PluginManagerService } from './plugin-manager.service.js';

@Controller('plugins')
export class PluginController {
  constructor(private readonly pluginManager: PluginManagerService) {}

  @Get()
  @Roles('admin')
  async listPlugins() {
    return this.pluginManager.getDiscoveredPluginsWithStatus();
  }

  @Get(':name')
  @Roles('admin')
  async getPlugin(@Param('name') name: string) {
    const allPlugins = await this.pluginManager.getDiscoveredPluginsWithStatus();
    const plugin = allPlugins.find((p) => p.name === name);

    if (!plugin) {
      throw new NotFoundException(`Plugin "${name}" not found`);
    }

    return plugin;
  }

  @Post(':name/install')
  @Roles('admin')
  async installPlugin(@Param('name') name: string) {
    try {
      await this.pluginManager.installPlugin(name);
      return { success: true, message: `Plugin "${name}" installed` };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to install plugin',
      );
    }
  }

  @Post(':name/uninstall')
  @Roles('admin')
  async uninstallPlugin(@Param('name') name: string) {
    try {
      await this.pluginManager.uninstallPlugin(name);
      return { success: true, message: `Plugin "${name}" uninstalled` };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to uninstall plugin',
      );
    }
  }

  @Post(':name/enable')
  @Roles('admin')
  async enablePlugin(@Param('name') name: string) {
    try {
      await this.pluginManager.enablePlugin(name);
      return { success: true, message: `Plugin "${name}" enabled` };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to enable plugin',
      );
    }
  }

  @Post(':name/disable')
  @Roles('admin')
  async disablePlugin(@Param('name') name: string) {
    try {
      await this.pluginManager.disablePlugin(name);
      return { success: true, message: `Plugin "${name}" disabled` };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to disable plugin',
      );
    }
  }

  @Get(':name/settings')
  @Roles('admin')
  async getSettings(@Param('name') name: string) {
    const definitions = this.pluginManager.getPluginSettingDefinitions(name);
    const values = await this.pluginManager.getPluginSettings(name);
    return { name, definitions, values };
  }

  @Put(':name/settings')
  @Roles('admin')
  async updateSettings(
    @Param('name') name: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.pluginManager.updatePluginSettings(name, body);
    return { success: true, message: `Settings updated for plugin "${name}"` };
  }
}

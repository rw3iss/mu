import { Injectable, Logger } from '@nestjs/common';
import type { PluginUiSlotItem } from './plugin.interface.js';

@Injectable()
export class PluginUiRegistryService {
  private readonly logger = new Logger('PluginUiRegistry');
  // Map<slotName, Map<pluginName, PluginUiSlotItem[]>>
  private readonly slots = new Map<string, Map<string, PluginUiSlotItem[]>>();

  register(pluginName: string, slot: string, item: PluginUiSlotItem): void {
    if (!this.slots.has(slot)) {
      this.slots.set(slot, new Map());
    }
    const slotMap = this.slots.get(slot)!;
    const items = slotMap.get(pluginName) ?? [];
    items.push(item);
    slotMap.set(pluginName, items);
    this.logger.log(
      `Registered UI slot item "${item.id}" in slot "${slot}" for plugin "${pluginName}"`,
    );
  }

  unregisterAll(pluginName: string): void {
    for (const [, slotMap] of this.slots) {
      slotMap.delete(pluginName);
    }
    this.logger.log(`Unregistered all UI slot items for plugin "${pluginName}"`);
  }

  /**
   * Get all items for a slot, sorted by priority (lower = first).
   */
  getSlotItems(slot: string, _context?: Record<string, string>): PluginUiSlotItem[] {
    const slotMap = this.slots.get(slot);
    if (!slotMap) return [];

    const allItems: PluginUiSlotItem[] = [];
    for (const [, items] of slotMap) {
      allItems.push(...items);
    }

    return allItems.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }
}

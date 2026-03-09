import { signal } from '@preact/signals';
import type { UISlotName } from './ui-slots';
import { UI_SLOT_NAMES } from './ui-slots';
import type { SlotRenderer, SlotRenderContext } from './plugin-client.interface';

interface SlotRegistration {
	pluginName: string;
	renderer: SlotRenderer;
	priority: number;
}

/**
 * Manages UI slot registrations from plugins.
 * Plugins register renderer functions for named slots.
 * When the UI renders a <PluginSlot>, it calls all registered renderers for that slot.
 */
class PluginSlotManager {
	/** Map<slotName, SlotRegistration[]> */
	private slots = new Map<string, SlotRegistration[]>();

	/** Incremented on every registration change to trigger re-renders */
	readonly version = signal(0);

	register(pluginName: string, slotName: string, renderer: SlotRenderer, priority = 100): void {
		if (!UI_SLOT_NAMES.includes(slotName as UISlotName)) {
			console.warn(
				`Plugin "${pluginName}" tried to register unknown slot "${slotName}". Valid slots:`,
				UI_SLOT_NAMES,
			);
			return;
		}

		const list = this.slots.get(slotName) ?? [];
		list.push({ pluginName, renderer, priority });
		list.sort((a, b) => a.priority - b.priority);
		this.slots.set(slotName, list);
		this.version.value++;
	}

	unregisterAll(pluginName: string): void {
		for (const [slotName, list] of this.slots) {
			const filtered = list.filter((r) => r.pluginName !== pluginName);
			if (filtered.length === 0) {
				this.slots.delete(slotName);
			} else {
				this.slots.set(slotName, filtered);
			}
		}
		this.version.value++;
	}

	getRenderers(slotName: string): SlotRegistration[] {
		return this.slots.get(slotName) ?? [];
	}

	renderSlot(slotName: string, context: SlotRenderContext) {
		const registrations = this.getRenderers(slotName);
		return registrations.map((reg) => {
			try {
				return reg.renderer(context);
			} catch (err) {
				console.error(
					`Plugin "${reg.pluginName}" error rendering slot "${slotName}":`,
					err,
				);
				return null;
			}
		});
	}
}

export const pluginSlotManager = new PluginSlotManager();

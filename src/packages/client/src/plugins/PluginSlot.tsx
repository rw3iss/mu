import type { SlotRenderContext } from './plugin-client.interface';
import { pluginSlotManager } from './plugin-slot-manager';
import type { UISlotName } from './ui-slots';

interface PluginSlotProps {
	name: UISlotName;
	context: SlotRenderContext;
}

/**
 * Renders all plugin-registered components for a named UI slot.
 * Place this component wherever plugins should be able to inject content.
 *
 * Usage:
 *   import { UI } from '@/plugins/ui-slots';
 *   <PluginSlot name={UI.INFO_PANEL} context={{ movie }} />
 */
export function PluginSlot({ name, context }: PluginSlotProps) {
	// Reading version.value triggers re-render when plugins register/unregister
	const _version = pluginSlotManager.version.value;

	const elements = pluginSlotManager.renderSlot(name, context);
	const filtered = elements.filter(Boolean);

	if (filtered.length === 0) return null;

	return <>{filtered}</>;
}

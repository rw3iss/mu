import type { VNode } from 'preact';
import type { UISlotName } from './ui-slots';

/**
 * Context for rendering a slot — passed to each registered slot renderer.
 * Contains data relevant to the UI location where the slot appears.
 */
export interface SlotRenderContext {
	movie?: {
		id: string;
		title: string;
		year?: number;
		overview?: string;
		posterUrl?: string;
		rating?: number;
		imdbRating?: number;
		rtRating?: number;
		metacriticRating?: number;
		[key: string]: unknown;
	};
	playlist?: {
		id: string;
		name: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/**
 * A slot renderer function. Receives the slot context and returns
 * a Preact VNode (or null to render nothing).
 */
export type SlotRenderer = (context: SlotRenderContext) => VNode | null;

/**
 * Context passed to a plugin client during initialization.
 * Plugins use this to register UI slot renderers and access the API client.
 */
export interface PluginClientContext {
	pluginName: string;
	/** Register renderers for named UI slots */
	slots: {
		register(slotName: UISlotName, renderer: SlotRenderer, priority?: number): void;
	};
	/** Base API helper scoped to this plugin's endpoints */
	api: {
		get<T = unknown>(path: string, params?: Record<string, string>): Promise<T>;
		post<T = unknown>(path: string, body?: unknown): Promise<T>;
		put<T = unknown>(path: string, body?: unknown): Promise<T>;
		delete<T = unknown>(path: string): Promise<T>;
	};
}

/**
 * Interface that client-side plugin modules must implement.
 * Each plugin exports a default class implementing this interface.
 */
export interface IPluginClient {
	onLoad(context: PluginClientContext): void | Promise<void>;
	onUnload?(): void;
}

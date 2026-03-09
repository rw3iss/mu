import { h } from 'preact';
import { Button } from '@/components/common/Button';
import { UI } from '@/plugins/ui-slots';
import type {
	IPluginClient,
	PluginClientContext,
} from '@/plugins/plugin-client.interface';

export default class ExampleInfoClient implements IPluginClient {
	private context: PluginClientContext | null = null;

	async getMoreInfo(movieId: string) {
		if (!this.context) return;
		try {
			const data = await this.context.api.get<{ facts: string[] }>(`/trivia/${movieId}`);
			console.log('[example-info] trivia:', data);
		} catch (err) {
			console.error('[example-info] Failed to fetch trivia:', err);
		}
	}

	onLoad(context: PluginClientContext): void {
		this.context = context;
		const self = this;

		// Register a renderer for the INFO_PANEL slot
		context.slots.register(UI.INFO_PANEL, ({ movie }) => {
			if (!movie) return null;

			return (
				<div style={{ padding: '12px 0' }}>
					<h3 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600 }}>
						Plugin Info
					</h3>
					<p style={{ margin: '0 0 6px', fontSize: '13px', opacity: 0.8 }}>
						This content was injected by the example-info plugin.
					</p>
					<p style={{ margin: '0 0 6px', fontSize: '13px', opacity: 0.6 }}>
						Movie: {movie?.title}
					</p>
					<Button variant="primary" size="sm" onClick={() => self.getMoreInfo(movie.id)}>
						{'\u25B6'} See more
					</Button>
				</div>
			);
		});

		// Register a renderer for the INFO_PANELINFO_PANEL slot
		context.slots.register(UI.DASHBOARD_TOP, ({}) => {
			return ("Example info content.");
		});

		console.log('[example-info] Client plugin loaded');
	}

	onUnload(): void {
		this.context = null;
		console.log('[example-info] Client plugin unloaded');
	}
}

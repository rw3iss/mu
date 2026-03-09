Plugin system:

Currently we offer users the ability to enable different plugins in the system, but we don't really have a unified interface or API for the plugins to be useful.

Let's design a system-level api, that the plugins can utilize in their code, so they can be integrated into the system to do custom things.

If you want to help design a nice and flexible plugin system, then you can extend or modify these ideas, using best architectural practices, but this is what I want:

Each "plugin" will need to define certain code or actions to execute during different stages, ie. during installation, or during load. The plugins should also be able to react to certain actions, or events, and also be able to render or modify existing UI functionality. Therefore, I think we should design a kind of "hooks"-like system, for custom Plugins to utilize.

When plugins are loaded, during application initialization, they can register themselves to execute certain actions during specific hooks (like application start, application loaded), and also during events (like movie stopped, move playing, etc). The events system could eventually be sparse and generic, so let's keep that in mind and keep it kind of loose, but somewhat flexible.

Let's go through some examples.
One plugin might be for 'IMDB', where it can expose actions on the UI, or information, related to IMDB, and also extended abilities to search, etc.
		- plugin's need to define json config of their basic info, and api endpoint config for client and server, for auto-generation and binding of endpoints?
		- only create server or client instances if they're in the config?


Plugin builder/helper script:
- user defines Plugin on server, registerApiEndpoint registers custom global endpoints
- user can query new backend 'schema' endpoint for the registered plugin (with query string)
- client can run 'api generation' script from the backend schema:
	- plugin:generate-client-api <plugin-id>: launches server, enables   plugin is registered  , for a custom plugin's registered endpoints, or otherwise the entire api (all endpoints and plugins)

"plugin:generate <plugin-id>": scaffold out the plugin files:
./plugins/plugin-id/
	client/
		PluginIdApi.ts
		PludinIdClient.ts
	server/
		PluginId.ts

server/PluginId.ts:
```ts
class PluginReviewSerice {
	const fetchReviews(app, { movieId }: { movieId: string }) {
		// can use cache, etc...
	}
}

class Plugin extends BasePlugin {

	constructor() {
		this.reviewService = new PluginReviewService();
	}

	const onInstall(app) {
		// setup plugin tables (run migration), etc.
	}

	const onUninstall(app) {
		// remove plugin tables and associated data
	}

	const onEnable(app) {
	}

	const onDisable(app) {
	}

	// called if plugin is enabled during application startup
	const onLoad(app) {
		// register api endpoints
		// todo: load from config somehow, so client can be built?
		app.registerApiEndpoint('fetchReviews', this.reviewService.fetchReviews);
	}

}
```

The following PluginClientApi can be automatically generated from the plugin:generate-client-api npm script, if the user wants.
The script will request the current registered endpoints schema for this current plugin, given by the 'plugin-id' in the script arguments, from the new custom ie. "api/schema?plugin=plugin-id" endpoint, which will generate the json schema for that plugin's registered API endpoints. Then, the custom generate-client-api script will use that schema and plugin-id to generate a TypeScript client with all of the methods bound to each of the plugins API endpoints, in a custom file for that plugin (ie. "plugin-id.api.ts", in the plugin's custom folder when registered or installed).
Each method of the custom API client should fetch to the registered endpoint, using that method's schema as it's signature. The fetch methods should be wrapped by a reference to the internal service manager, that the regular app uses, however it is currently using the backend API to access itself, so it can wrap the custom plugin requests just the same with the current user's Authentication token, and anything else that the core system should handle.The script's generated Custom API client should know to call that core service, so it automatically wraps the Authorization headers, using an internal API, where the client just needs to send the endpoint, method type, params/data, and any other necessary variables, to the internal service or api system. Ensure the architecture for the internal API system is usable by outside requests as such, ie. by the custom plugin clients that are automatically generated.

client/PluginIdApi.ts:
```ts
// If the client is auto-generated, from a plugin-id and it's generated schema: it might look like this:
class PluginClientApi {
	constructor(api) {
		this.api = api; // store a reference to the internal api service, for use later in the requests, when loaded
	}

	// the method, params, get call, request url, and params to the get call, would all automatically be generated from the generate-client-api script, from the registered schema endpoints and their configuration.
	fetchReviews(movieId) {
		// can use cache if client was built with 'client cache enabled', otherwise can fetch using internal api:
		return await this.api.get("/api/plugins/plugin-id/fetch-reviews", { movieId });
	}
}
```

client/PluginIdClient.ts:
```ts
// Then the user would write their own Plugin client, ie:
class PluginClient {

	constructor(app) {
		this.api = new PluginClientApi(); // maybe this can be automated at app startup from the current directory of custom plugin api files, but they need a reference to it somewhere.
		// otherwise this would be accessed from ie.: this.api = app.plugins['plugin-id'].api; // <-- api is pre-registered automatically on app initialization, and reference is stored here
	}

	const onLoad(app) {
		this.registerUi();
	}

	const registerUi(app) {
		app.registerUiElement(UI.INFO_PANEL, 'ref-id?', this.ui__movieInfoPanel); // this registers the method in an internal list for each "UI.*" element, replacing any with the given ref-id. When that section is rendered, it will ask the internal system to render each of the bound methods, with some given parameters, and show the returned components.
	}

	const ui__movieInfoPanel(app, params) {
		if (!params.movie) return undefined;
		if (app.settings.showImdb) {
			const reviews = this.api.fetchReviews(params.movie.id); // fetch reviews from registered api, uses cache possibly
			return <div>Render the {reviews}</div>
		}
	}
}
```

	server:
		- on install: add imdb tables/columns
		- on uninstall: removed imdb tables/columns
		- on load:
			- register custom backend api endpoints, ie:
				- extend BasePlugin
					- this.registerApiMethod('/path/:param', this.handler, { cachee);
					-

		- on fetch movie metadata: fetch imdb metadata, put into db

	client:
		- * create helper utility to "build" plugins registered api endpoints into service class for it, ie:
			Plugins.this.api.fetchMovieRating(movie.id);
			- option in utility to cache the results client-side, and server-side.
		- registerUiElement(INFO_PANEL, ({params}) => {
				if (params.movie) {
					return <CustomImdbReviewsRatingsComponent />
				}
			});
		- registerUiElement(RATINGS, onRender({params}) => {
				// look for imdb data in records, or fetch from backend:
				this.api.
				if (params.movie) return
			});
		- api: {
			fetchImdbRating:
		}

--------------------------------------------------------------------------------

Example: EQ + Compressor:
	- "modify audio stream" api
	- render UI button in player bar + popup panel -> changes settings
	- add section to Settings > Playback > EQ + Compression: (eq enabled, compressor enabled, default profiles, see profiles (opens flyout editor?))

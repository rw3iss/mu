
Here is how the scaffolding script should work:
A lot of the existing plugin interface exists, and the below is just an example. You should build off the existing system, but add functionality mentioned here as needed (ie. automatically registering the plugin api endpoints so the clients can automatically be generated from its schema).

npm command "plugin:generate <plugin-id>": scaffold out the plugin files:
(validate the plugin-id is a simple valid filename id, and the plugin-id folder doesn't already exist), then generate:
(create a PascaleCase name from the plugin-id, to be used for the auto-generated class names).

./plugins/plugin-id/
    manifest.json   // generate the manifest.json
	package.json    // generate a basic package.json
	index.ts
	client/
		plugin-id-api.ts      // generated/replaced later, but stubbed for now
		plugin-id-cilient.ts


plugin-id/index.ts:
```ts
class PluginId extends BasePlugin {

	constructor(app) {
		// this.service = new PluginIdService(app); // user can register custom services to use
	}

	// called when user first installs the plugin
	const onInstall(app) {
		// setup plugin tables (run migration), etc.
	}

	// called when user uninstalls the plugin
	const onUninstall(app) {
		// remove plugin tables and associated data
	}

	// called when plugin is enabled
	const onEnable(app) {
	}

	// called when plugin is disabled
	const onDisable(app) {
	}

	// called if plugin is enabled during application startup
	const onLoad(app) {
		// app.registerApiEndpoint('clientMethodName', '/api-path-after-base-path', this.service.doSomething); // this tells the app to register the custom Endpoint to the api registry, for this plugin
	}

}
```

plugin-id/client/plugin-id-client.ts:
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
		// the user would register custom UI components here...
		app.ui.registerElement(UI.INFO_PANEL, 'ref-id?', this.ui__movieInfoPanel); // this registers the method in an internal list for each "UI.*" element, replacing any with the given ref-id. When that section is rendered, it will ask the internal system to render each of the bound methods, with some given parameters, and show the returned components.
	}

	// example of what should happen when a custom UI component is requested
	const ui__movieInfoPanel(app, params) {
		if (!params.movie) return undefined;
		if (app.settings.showImdb) {
			const reviews = this.api.fetchReviews(params.movie.id); // fetch reviews from registered api, uses cache possibly
			return <div>Render the {reviews}</div>
		}
	}
}
```

The following PluginClientApi can be automatically generated from the plugin:generate-client-api npm script, if the user wants.
The script will request the current registered endpoints schema for this current plugin, given by the 'plugin-id' in the script arguments, from the new custom ie. "api/schema?plugin=plugin-id" endpoint, which will generate the json schema for that plugin's registered API endpoints. Then, the custom generate-client-api script will use that schema and plugin-id to generate a TypeScript client with all of the methods bound to each of the plugins API endpoints, in a custom file for that plugin (ie. "plugin-id-api.ts", in the plugin's custom folder when registered or installed).

Each method of the custom API client should fetch to the registered endpoint, using that method's schema as it's signature.
The fetch methods should be wrapped by a reference to the internal service manager, that the regular app uses, however it is currently using the backend API to access itself, so it can wrap the custom plugin requests with the current user's Authentication token, and anything else that the core system should handle under the hood outside of the plugin system.
The script's generated Custom API client should know to call that core service, so it automatically wraps the Authorization headers, using an internal API, where the client just needs to send the endpoint, method type, params/data, and any other necessary variables, to the internal service or api system.
Ensure the architecture for the internal API system is usable by outside requests as such, ie. by the custom plugin clients that are automatically generated.

This file would be automatically generated using the "plugin:generate-client-api <plugin-id>" command, which will run a script that tries to query the currently running background NestJS api, or otherwise starts the NestJS api, and waits for it to be ready, then tries to request the given plugin-id's custom api schema from the custom api schema registry we made, ie. from: /api/schema?plugin=plugin-id
Which should return the json for the plugin, all of its endpoints, their input signatures, and maybe response types. Then the 'generate-client-api' script would use that schema to generate a "<plugin-id>-api.ts" file, that has a method for each of the custom

plugin-id/client/plugin-id-api.ts:
```ts
// If the client is auto-generated, from a plugin-id and it's generated schema: it might look like this:
class PluginIdApi {

	constructor(app) {
		this.api = app.api; // for example, store a reference to the internal api service, for use later in the requests, when loaded, or just use the hook utility or something to tie into the existing system.
	}

	// the method, params, get call, request url, and params to the get call, would all automatically be generated from the generate-client-api script, from the registered schema endpoints and their configuration.
	clientMethodName(movieId: string) { // params are auto-injected from registered schema
		// can use cache if client was built with 'client cache enabled', otherwise can fetch using internal api:
		return await this.api.get("/api/plugins/plugin-id/api-path-after-base-path'", { movieId }); // param is auto-injected, and underlying 'api' system automatically encoded the params to GET query params.
	}
}
```

Modify the above Api interface to support the system as needed (ie. constructor params/references). It is an example.

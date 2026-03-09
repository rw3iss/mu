Plugin system:

Currently we offer users the ability to enable different plugins in the system, but we don't really have a unified interface or API for the plugins to be useful.

Let's design a system-level api, that the plugins can utilize in their code, so they can be integrated into the system to do custom things.
Extend the existing Plugins system in the backend to support registering the custom plugins.

If you want to help design a nice and flexible plugin system, then you can extend or modify these ideas, using best architectural practices, but this is what I want:

Each "plugin" will need to define certain code or actions to execute during different stages, ie. during installation, or during load. The plugins should also be able to react to certain actions, or events, and also be able to render or modify existing UI functionality.
I think we should help the users and plugin developers by generating some plugin scaffolding scripts.
See this file: ./Plugin_Scaffold.md
for instructions on how the scaffolding scripts should be created and work. Create the scaffolding scripts as node scripts in the ./scripts directory, and expose them in the package.json.

Here's how the plugin creation process should work:
- user scaffolds a plugin with a given plugin id, plugin folder and files are generated.
- user customizes the server/<plugin-id>.ts file as they need (it will register api endpoints, etc)
- with backend running, user can run the client api generation script, to retrieve that plugin's schema, and generate a client api class to use in the client (after they finish building and registering the server endpoints).

For this system to work, the plugin:generate-client-api script needs the backend to generate the plugin schemas.
So we need a new endpoint to generate the current backend api schema.
Whenever a plugin might call "context.api.registerEndpoint(...)" when the server starts up, and calls the plugin's onLoad method, then this method should know to keep a registry of internal custom plugin api methods, and their information, so it can generate a schema for it whenever the /api/schema endpoint is requested.
We need to develop an internal service to keep track of registered api endpoints, that plugin's might register.
Developer a service to do that: it can just keep track of all of the endpoints in memory.
Then, create a new endpoint in the api service, a GET /api/schema endpoint, that will call a utility to generate a schema for all registered endpoints, and print its json output.
The endpoint should support a custom ?plugin=<plugin-id> query parameter, which should limit the output json to only the endpoints registered by that specific plugin-id.
When a plugin registers a custom API endpoint, the schema should build from it, but they will also register a function handler for the endpoint. This function will take some parameters, and also might return a type. If possible, can you try to use TypeScript's systems to find the handler method's parameter names, and their types, and also the return type, if possible? We want to try to add the handler input parameters as "inputs" to the client-side api auto-created methods, by detecting the method's parameter names and types, and adding them to the registry json for the api endpoint, so it can generated in the schema, and the client built from it. Is it possible to do that? If possible we can do it at runtime, or compile time during the generate-client-api script call, if that's easier. Can you find a way to do that? Have the schema show the full endpoint path, its HTTP method, the clientMethodName, and the input parameter schema, as well as return/response schema, if possible.

Once this endpoint exists, build the plugin:generate-client-api script so that it will query the given plugin's schema, from the running NestJS instance (or start one using the NestJS internal scripts system), at that endpoint.
Have the script take the schema and build out the full client/plugin-id-api.ts from the schema.
Ensure that the client api classes utilize the underlying service utilities or existing classes, to it will wrap the authorization and all.
The calls to the custom plugin api's that it builds, should know to also prefix the plugin's registered endpoints with ie. "/api/plugins/plugin-id/...", however the /api/schema?plugin=plugin-id endpoint should already returns the full endpoint paths, that includes that prefix based on the requested plugin-id, and its registered paths (the full paths should be set an endpoint registration anyway, so the schema should have it).

For the general plugin registration and loading system to work, you'll notice I'm referencing an "app" or "context" variable in most of the methods.
This is supposed to signify the main application instance, which you should create and reference somewhere, and pass around to these underlying system. This can be the existing plugin system's "PluginContext", but we need to make sure we build on it and it can access the service to register api endpoints, custom to that plugin.
Otherwise, it should be some kind of NestJS context that we can extend.
We can add any functionality to this main application class.
For instance, you'll notice I have some code commented in the scaffolded server PluginId.ts file, ie. context.registerApiEndpoint(...). We should expose the underlying system to register custom endpoints to the plugins within the app context in this way, either directly through adding a method to it like that, which calls the internal registry to actually register/bind the endpoint, and put it in the schema for /api/schema to build from.

Generate those scripts to build the Plugin scaffolding, and Client api from it, given the above examples.
You can design it more resilient, flexible, and better if you see a way to do it any point. The plugin system should be flexible, and be semi-automated, with helpful scripts to help the developers automatically build out the API classes to match their custom registered api plugin endpoints, for example.

We need to refactor the plugin system to support all of this.
When the NestJS app starts, expose the App instance somehow to the underlying systems, and design and build out the "plugin" system described above to work with the current system.
When the system loads, it should look for any existing plugins in the './plugins' directory, and try to load them, so they at least show in the Plugins page.
The plugins need to support a variable 'status' property, such as just 'not installed', 'enabled', 'disabled', etc.
Any plugins that are detected should try to be shown as 'not installed'. If they are installed, it should should show if they are enabled or not.
If any plugins error when loading, the system should store the error and show it in the plugins page on that plugin item.

In the referenced "Plugin_Scaffold.md" document, the client/plugin-id-client.ts code references a "UI" variable, which would be a global enum of valid UI references to inject components in. Within this new plugin system.
There might be other "UI" locations, such as "PLAY_BAR_BUTTON" (would register buttons to show in the player bar, for example).
We probably need to have more of a strict input component for each registered section, but for now let's have they just register the method and render the arbitrary returned content. ie. custom controls the player would create in their plugin, and inject into the existing system, as the same kind of controls. You can design a nice way about it for now, to inject any components anywhere, and have them be able to call the custom methods and api endpoints, in an automated fashion if possible.

The "app.ui.registerElement" is a custom method built on the app context. I was thinking the 'ui' property could become a new class or server, put onto the app context, which can give the user's or system a way to talk to or control the ui, including extending it. For nopw it can just become a registry of registered UI methods to call or run when "hooks" are called for that element's location or placeholder. It can be an instance of some other class, or anything that helps the system to keep a registry of custom methods that can be called at runtime, and return UI components that can be placed and rendered at those locations in the valid "UI" areas. When these methods are called, the underlying system should "register" their bindings, to that specific area's list, that will be called later when a "hook" is called to render any registered components in that area.

Once this system is built, also modify the client to call special utility functions to call the registered methods, and display the returned components in those areas, such as in the info panel, or elsewhere if you see convenient places for plugins to render custom pieces to, such as in the sidebar to return new sidebar items, or add a new section to the Settings, etc, etc. It can really do anything custom, but we should help the user a little by giving them "plugs" or hooks of places they are allowed to render or tie components into, as well as a basic plugins api to work with, that can talk to or use existing core infrastructure.

We can start with the player's flyout "info panel" as an example. In this info panel, add a "hook" to call the underlying system to call any methods that were registered to the "UI.INFO_PANEL" reference, like the above example.
In each context, it will pass custom parameters for that context. So for this Info Panel, the context will just be the movie, for now, so call each method, passing the { movie } object as a parameter. That custom method will return a component, which should get added to a list and rendered at the bottom of the flyout Info Panel, where the "hook" was called.

Implement a basic plugin test to demonstrate that, and have the system be able to render any registered components, passing the custom arguments during their rundtime render calls, and display them in the location the hook was called, using the Info Panel as an example.
You can build new test plugins to test the functionality, or also extend the existing plugins to have them try to register custom api endpoint methods, to handle client-side requests, and build client-side versions (using the above models as examples) that call the ie. "registerUiElement

Once we generate some plugins, they will show in the list, then after we edit them a bit, we will try to 'install' them.
Make sure their are api endpoints to support the new plugin system, ie. to request to install one, and return the status (ie. error, success), and update it on the Plugins page.

Build off of the existing plugin system, and modify or add functionality as needed to ensure it is flexible, and has the ability to work in the automated ways.
The automatic schema registration is only necessary if we don't have another built-in way to see the registered NestJS routes, and their method signatures (ie. through a swagger or openai schema or something).
If you know of a way to do that, through NestJS, and still be able to see what plugin's registered what routes (ie. see who regisetered the route), and be able to filter the schema later, on the fly, by the plugin-in, then let's try to do that, otherwise we need to build the custom api plugin registry.

Extend the backend plugin system according to the above, and test the /api/schema endpoint with custom test plugins you can build upon, in order to generate and build the frontend clients automatically, hooked up the backend API endpoints, and test their methods and parameters, if you can.
If you see any missing parts in the above design, you should fill them in.
Once you have a complete picture of the plugin system, and the plan to build it, go ahead and build it into the platform. Modify any existing plugins and the plugin system as needed.

Also, once you build the system out, write some developer documentation on how to use the system, and all of its aspects, as if one we're needing to know how to build a custom plugin, for any purpose, and add to the backend and frontend functionality, with examples, in a ./docs/PLUGINS.md document.

--------------------------------------------------------------------------------

Example: EQ + Compressor:
	- "modify audio stream" api
	- render UI button in player bar + popup panel -> changes settings
	- add section to Settings > Playback > EQ + Compression: (eq enabled, compressor enabled, default profiles, see profiles (opens flyout editor?))


--------------------------------------------------------------------------------

Plugin UI API examples:

- draw a section with a custom component in the flyout Info Panel, when a movie is playing:

	ui.player.infoPanel.addSection('section-id', {
		title: string | undefined,
		subTitle: string | undefined,
		render: (this, params) => <CustomComponent movie={params?.movie} />
	})

- add a button to the player bar:

	ui.player.buttonBar.addButton('button-id', {
		render: (this, params) => <CustomButtonComponent movie={params?.movie} />
	})

- what if the user wants to add a "meter" to the button bar?
	ui.player.buttonBar.addButton('button-id', {
		render: (this, params) => <CustomMeter movie={params?.movie} playContext={params.videoContext} />
	})

--------------------------------------------------------------------------------


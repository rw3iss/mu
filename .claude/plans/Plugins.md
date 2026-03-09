Plugin system:

Currently we offer users the ability to enable different plugins in the system, but we don't really have a unified interface or API for the plugins to be useful.

Let's design a system-level api, that the plugins can utilize in their code, so they can be integrated into the system to do custom things.

If you want to help design a nice and flexible plugin system, then you can extend or modify these ideas, using best architectural practices, but this is what I want:

Each "plugin" will need to define certain code or actions to execute during different stages, ie. during installation, or during load. The plugins should also be able to react to certain actions, or events, and also be able to render or modify existing UI functionality. Therefore, I think we should design a kind of "hooks"-like system, for custom Plugins to utilize.

When plugins are loaded, during application initialization, they can register themselves to execute certain actions during specific hooks (like application start, application loaded), and also during events (like movie stopped, move playing, etc). The events system could eventually be sparse and generic, so let's keep that in mind and keep it kind of loose, but somewhat flexible.

Let's go through some examples.
One plugin might be for 'IMDB', where it can expose actions on the UI, or information, related to IMDB, and also extended abilities to search, etc.
--------------------------------------------------------------------------------

Example: EQ + Compressor:
	- "modify audio stream" api
	- render UI button in player bar + popup panel -> changes settings
	- add section to Settings > Playback > EQ + Compression: (eq enabled, compressor enabled, default profiles, see profiles (opens flyout editor?))

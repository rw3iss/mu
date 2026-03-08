- Need movie file exif/metadata parser, lookup stage.

- Ratings: when clicked, show breakout of 1-10 stars, with number entry on left and decimal up/down buttons. Allow half-stars in overlay. Close/cancel button on end.
	- user clicks a main number, zooms in between that and next number, with mini decimal scale? Right click or click outside to stay at X.0.

- Audio eq+compression plugin
	- configure maximum processing/quality?
	- find third party server-based eq+compression?
		- add eq+compression profiles to be assigned custom to each movie, ie. "Use sound profile: X"

- Movie Info Flyout Panel:
	- Add Move title, description, metadata, and Playlists.
	- Button to fetch rating and reviews if they aren't loaded. (need "ratings and reviews" module).

Move the 'Plugins' sidebar page item to instead become a section in the 'Settings' page itself. Move all of the internal components and functionality of the plugins page, to the new Plugins section in the settings. You can keep the entire component, just rename as needed (ie. it's not a page anymore). The Settings page will not be where users control the plugins.
Also do the same for the 'Admin' section: Show it as a new menu item in the Settings page, and remove the sidebar Admin item.


- Subtitle integration

- Add commenting/Notes plugin (personal comments) to ie. add notes to personal video files.

- Movie Page:
	- add mini features to grab extended data for a movie, like:
		- fetch cast: compiles top cast members from third parties, stores in our backend for that movie (we begin to keep people DB).
		- fetch reviews: load reviews, similarly.


- IMDB plugin:
	- Settings: show imdb rating, show imdb reviews
	- Movie page: Show IMDB rating, show imdb reviews
	-

- PLUGIN: Public comments for a movie:
	- movie must have imdb/tmdb association
	- need central movie db to store public comments
	- show comments icon in player
	- load comments, add, options to show them popup as "live comments" and options for "highest rated comments when conflicts"

- PLUGIN: Integrate web urls or other video websites, ie. Watch youtube, twitch from the app.

- add 'Pick a movie' for movie... open page user can page through movie options, set filters, "Movie Picker"


--------------------------------------------------------------------------------

Later/advanced:
- Add "Movie URLs" or references to web urls as movies, or "to watch" urls such as a youtube url, etc?
	- some way to organize arbitrary web videos into library? filter by local vs. web?

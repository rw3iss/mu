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

- PLUGIN: Public comments for a movie:
	- movie must have imdb/tmdb association
	- need central movie db to store public comments
	- show comments icon in player
	- load comments, add, options to show them popup as "live comments" and options for "highest rated comments when conflicts"

- PLUGIN: Integrate web urls or other video websites, ie. Watch youtube, twitch from the app.

On the Movies listing page, there is a toggle button to change the list view from 'card' or 'list', but it doesn't seem to work.
It only shows the movies as cards.
Can you try to get the list view working, so it will show the movies in a vertical list.
Also can you add a sort direction toggle button after the sort by dropdown, to change the sort direction?
Searching or changing the sort or filter options should trigger a new backend query with those new search parameters, so later pagination and everything can work properly.

Also, on the movies page, add some more details to the movie cards and list items, such as the movie year, from the metadata, if available, also show the date the movie was added to the library, and maybe the rating for it, if there is one the user has set for that movie.

--------------------------------------------------------------------------------

Later/advanced:
- Add "Movie URLs" or references to web urls as movies, or "to watch" urls such as a youtube url, etc?
	- some way to organize arbitrary web videos into library? filter by local vs. web?

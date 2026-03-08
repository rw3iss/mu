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

- add 'Pick a movie' for movie... open page user can page through movie options, set filters, "Movie Picker"

- There is a slight playback bug where while the movie is playing, the seek bars button is sort of jumping from place to place, as it plays, every half second or so. Is there anyway you could get the knob button on the seek bar to move smoothly, or not jump at all? Just have it move in a straight line through the seek bar. Maybe we need to make the update interval faster, but others, if it's on an update interval, have it animate from the previous position to the next, according to the speed of the movie, ie. calculate the 'step animation speed' when the movie loads, to know how fast it should animate between each step. Unless you see an easier way to animate the button smoothly or naturally as the movie plays...
If the user clicks in a new seek bar location, or drags the seek bar, it shouldn't animate, it should just jump there, then when it begins playing, the animation should take over again.
If the user resizes the windows, or goes into fullscreen or out, the seek bar animation speed may need to be recalculated, depending on the seek bar length, if that's the solution we go with. Figure out a convenient or clever solution to have the seek bar play smoothly without jumping at all. Also ensure the seek bar positioning is accurate. Sometimes as it's playing, early on, it seems like the seek position jumps or skips back now and then.



# PLUGINS:
- EQ + Compressor

- IMDB plugin:
	- Settings: show imdb rating, show imdb reviews
	- Movie page: Show IMDB rating, show imdb reviews
	- Data import: import personal ratings and reviews (option to override local or skip), import playlists, watchlist, etc.

- Public comments for a movie:
	- movie must have imdb/tmdb association
	- need central movie db to store public comments
	- show comments icon in player
	- load comments, add, options to show them popup as "live comments" and options for "highest rated comments when conflicts"

- Other video sources?
	- Integrate web urls or other video websites, ie. Watch youtube, stream twitch from the app, etc. Even connect with other users for video meetings?

- Buddy Watch: connect with another user and show webcam thumbnail and watch the same movie together.


--------------------------------------------------------------------------------

Later/advanced:
- Add "Movie URLs" or references to web urls as movies, or "to watch" urls such as a youtube url, etc?
	- some way to organize arbitrary web videos into library? filter by local vs. web?

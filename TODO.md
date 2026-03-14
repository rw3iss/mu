
- Enable better cache control:
	- clear cache button in Settings > About - show modal to select cache items, option for older than?
	- show breakdown of app data: thumbnails, metadata, db, transcode data
	- option to 'Cache transcodes for up to X days', and also 'Max transcode cache size' - 20gb recommended

- Show "Info" panel in movie details page: file info, exif

- Advanced display options to show buffering data sizes/graphs? avg while playing and overall/total bandwidth over time.,

- Need to show option to "group" movies, or create sets to show as one (ie. tv series, etc):
	- add group_id to movie collection items
	- user can manually manage groups (later)
	- when scanning movies, after metadata is pulled, check if other items exist in the same kind of set or series (run algorithm to check "if series" somehow, analyzing metadata, filenames, etc).
		- if it detects similar/series items, put item's "group_id" into 'possible' state.
		- then in the frontend, for those items, if it sees 'possible', show a 'Group' option button on the Movie Details page.
		- when the Group button is clicked, explain their are multiple items matching, and ask if the user wants to combine them into one item, and show in a list on one page.
		- smart options to break apart seasons.
		- after items are "grouped", it can set the group_id to the parent item or same group guid that was created for it (ie. the reference to the imdb or something).
		- later, if new items are scanned that match the group, it can set them to 'possible', and when the user clicks 'group' on them, it can run the scan process again, and find all the new similar items, and then ask the user if it wants to add them all in a checklist.

- Ratings: when clicked, show breakout of 1-10 stars, with number entry on left and decimal up/down buttons. Allow half-stars in overlay. Close/cancel button on end.
	- user clicks a main number, zooms in between that and next number, with mini decimal scale? Right click or click outside to stay at X.0.

- Movie Info Flyout Panel:
	- Add Move title, description, metadata, and Playlists.
	- Button to fetch rating and reviews if they aren't loaded. (need "ratings and reviews" module).
	- api for plugins to render to
		- plugin hook: pluginInit: addInfoPanel(movie) => { registers function to render a component with data }
	- when flyout renders, calls 'addInfoPanel' for any plugin, passes current movie, component renders custom

- Subtitle integration... is?

- Movie Page:
	- add mini features to grab extended data for a movie, like:
		- fetch cast: compiles top cast members from third parties, stores in our backend for that movie (we begin to keep people DB).
		- fetch reviews: load reviews, similarly.

- add 'Pick a movie' for movie... open page user can page through movie options, set filters, "Movie Picker"

- Show modal to 'Resume or Restart' if a movie is played with a previous history position?

- Need easier "install script" or setup method.
	- can code be bundled? it's open source?
	- for now: checkout code, run server?
	- do background research, how does plex/jellyfin do this?

- need a 'play queue': add item to queue, remove, move to front of queue, play playlist, clear queue, see queue

- Discover > Trending: other movies cross joined with mine? filter by personalized vs not.

# PLUGINS:

- Movie Bookmarks:
	- add location + name/comment, see new button in player bar
	- need ui hook to draw an element on seek bar...
	- is this the same as comments?

- "EQ + Compressor":
	- show cpu usage?
	- configure maximum processing/quality?
	- find third party server-based eq+compression?
		- add eq+compression profiles to be assigned custom to each movie, ie. "Use sound profile: X"

- "Video Effects":
	- simply contrast/brightness, etc.
	- save profiles, assign to each movie

- IMDB plugin:
	- Settings: show imdb rating, show imdb reviews
	- Movie page: Show IMDB rating, show imdb reviews
	- Data import: import personal ratings and reviews (option to override local or skip), import playlists, watchlist, etc.

- "Notes":
	- add simple personal notes to movies/files.

- "Public Comments" for a movie:
	- movie must have imdb/tmdb association
	- need central movie db to store public comments
	- show comments icon in player
	- load comments, add, options to show them popup as "live comments" and options for "highest rated comments when conflicts"

- Other video sources?
	- Integrate web urls or other video websites, ie. Watch youtube, stream twitch from the app, etc. Even connect with other users for video meetings?

- "Buddy Watch":
	- connect with another user and show webcam thumbnail and watch the same movie together.


--------------------------------------------------------------------------------

Later/advanced:
- Add "Movie URLs" or references to web urls as movies, or "to watch" urls such as a youtube url, etc?
	- some way to organize arbitrary web videos into library? filter by local vs. web?

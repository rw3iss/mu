
- Show "Info" panel in movie details page: file info, exif

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

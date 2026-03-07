Movie Finder MCP:

I want you to help become a full-fledged system architect and developer for a new, all-in-one, movie cataloguing, watching/streaming, platform (ie. web app, mobile app, server app, etc), including extended "plugin"-like features (ie. to handle finding related torrent movie files using open torrent indexing sites to query to obtain magnets, for example, or other plugins like fetching ratings or reviews from third party sites such as rotten tomatoes or imdb, or a plugin to import imdb ratings, for example). It will be similar to 'Plex' or 'Jellyfin' solutions, and allow the user to connect different drives, folders, or servers, to the platform, to scan and organize their movies, then organize them into playlists, or watched/unwatched/to watch lists, if they want, and also rate them individually through the platform. Then, we will also later integrate our own MCP server, and embedding system, to be able to help the user find related movies more accurately.
The database on the self-hosted installation should be minimal (ie. sqlite) and not require the user to set anything up they don't need to. If the application does need a real database such as postgres, for any reason, you can require and install it.

I want to build a well-architected single-source solution for all of this.
First, we will start by creating two plan documents: a high-level plan, and a more detailed implementation plan.
I want the backend server, that will host the entire movie streaming system, login, web ui, and everything, to be written in Typescript (ie. node.js).
We may offload the streaming to other types of smaller or faster-running services, when we get to streaming the video feeds, but for now the main api and server should be in node.
You can use NestJS or Fastify, whichever is best for this use case.

The frontend client parts (for a hybrid PWA that works on the web or mobile), should be written in Preact, using the latest build and bundling practices (SASS integration, etc).
Create a dockerfile for the relevant parts. I want the backend server to be lightweight, so people can run it locally-hosted on a single machine, and ideally it would just be one application server that can handle everything, but spawn and manage sub-processes if it needs to.
The backend should utilize a caching system of some sort (either in memory, or a redis cache), whatever is the simplest setup when running standalone on a self-hosted server with a smallish memory footprint. We need a cache so we can query third party APIs (like IMDB), and cache the data so we don't need to hit their API for every request, if possible.

The standalone self-hosted server can rely on docker, but I want to avoid requiring the user to use docker, though it can be an option.
Instead, I would like this platform to come with an "install" executable, or otherwise remotely downloaded "install script" that helps download, install, and set the system up for the user, with whatever background services are needed.

Here are the general requirements I want in this platform.
Can you go through my ideas here, and organize it and break it out into the more thorough "high-level" plan I mentioned, at first.
After I review the high-level plan, I will let you know if it's ready, and tell you when to write the full implementation plan.
Feel free to add all necessary parts to the high-level plan, in order for you to understand later how to build the full, more detailed plan from it.


- need to use third-party/central movie DB for searching?


# Basic Requirements:
- allow users to login remotely from authenticated devices or IPs, or otherwise "no login" locally (if direct on server).
- create a 'plugin' system, that has the ability to tie into the main system to enhance certain features, like finding reviews on imdb for a given movie, or rotten tomatoes, etc. This could be a plugin system that relies on our own internal API or framework, or something easier. Create a Plugins page in the client dashboard to manage them (enable/disable, etc).
- allow managing 'directories' of movies to add to the database, which the server should monitor for changes while running, and update any changed file's metadata
- third party services to obtain various movie metadata (ie. imdb, tmdb (the movie database), etc), reviews, ratings for the current user (ie. login to third party service with their API key or account).
- third party service API key management (support IMDB, TMDB, others if possible), from the App settings.
- We need to rely on a third-party movie database to find the 'basic' movies. Eventually we might run this locally, but for now we can abstract it to a third party (ie. IMDB). We should design the caching layer to be utilized to cache the third party data whenever possible.
- Anytime a user adds "custom" data to an existing movie (ie. imdb reference), the system should maintain an internal list of "movies" which relates those movies to our own internal database of "custom data". So if a user "rates" a movie in our system, it should add a record for the movie into the database, and a rating for that movie into our own movie ratings table, referencing that movie from our movies table. Anytime a user adds a movie file, or a movie is scanned and added to the library, it should also fetch that movie's metadata, and add a record for it into our internal movie table, referencing the imdb or third party movie ID (it can support mutliple IDs, there should be multiple columns, ie. imdb_id, tmdb_id, etc).
That way anytime our system "touches" a movie, it should be added to the internal movies table to be "managed" by our system.
- Eventually we will fetch more "metadata" and information related to individual movies, their ratings, reviews, and maybe personal things from the user. So we should have a separate "movie_metadata" table to store all of that varied information. The basic movie table should be just be a reference or linking table between the third party servers and our local movies table, and the rest of the tables. All basic movie data (title, description, year, etc), can go in the main movies table, but any extended information (ie. all else) should go into the extended "movies_metadata" table. Separate the tables and design the schemas as needed.

- The backend should be able to fetch a movie, the server will find the file, and start parsing or encoding it to stream to the requested client, using optimal streaming settings. Design and integrate an efficient streaming solution, to stream any number of videos at a time (ie. in different tabs) to the requesting clients that are connected to this movie platform's running server.

- "App server dashboard" page to manage the running server, see issues, statistics, restart it, etc.

- Eventually it would be convenient to find or use an MCP server to find related to movies.
	- Create API to ask for movie recommendations based on:
		- entire existing catalog
		- subset of movies (single or multiple)
		- option to cross join to remove "already watched"
	- when movies are rated, MCP server is updated
	- when new movies are added/removed, or playlists changes

- Movies list page has conveniences like a 'quick ui' to bulk select items, and 'mark as watched' or 'add to playlist'

- Design a nice and standard "Movie player" page in the app, so when I click 'play' on a movie, it will beging streaming it, with a control bar at the bottom, and other options to ie. change settings, enable subtitles, go fullscreen, see movie info, etc.

- "quick ui" to 'mark as watched' for single or bulk selection of movies

- Separate mobile/web application (can use the same web code as the desktop web application, ie. PWA) that connected to the main running server to browse, view, and stream the movies.

- User should be able to create playlists and add movies to it.

- backend should have full API to support all operations.
- backend streaming endpoints should be efficiently implemented using optimal streaming techniques, or third party libraries if they're optimal.
	- backend can stream through a separate service, ie. a Go server, if it is a lot more efficient, otherwise one server is good.

- Eventually we also want to search directors, actors, genres, etc.

--------------------------------------------------------------------------------

# Features I want to Make better:
- smarter about what was "Recently added/scanned" (ie. smart watchers on server that update the library and metadata correctly)
- Integrate 'Plugins', Torrent finder + magnets - create a plugin that users can enable in the Plugins page, that will allow them to 'search for torrents' when on a movie details page. This plugin will be configured with a list of torrent sites or APIs to query and scrape for 'magnet links', then show that magent link on the Movie Details page. Try to implement most of that, and allow the torrent urls to be configurable in the application backend ENV or configuration somewhere.
- Lookup/fetch movie info on the fly/in UI while watching (flyout) - I want to be able to 'see movie details' when watching a movie, by clicking a button on the play toolbar area, to see the movie details. A flyout should appear on the right side which shows the movie details, ratings, reviews, year released, director, title, description, etc. That should exist in the movie player page.

- "Mobile" version I can load quickly to look at my recently watched lists, find/manage new movies.
	- mobile 'rater' section, page through watched+unrated movies (move to end of list) ...

- MCP server: has all movies+embeddings? has DB of user's movies+ratings... how to find related?
	- extra data: scan movie reviews for some kind of similarilty?

- ratings with decimals (our rating system should support ie. '6.3' as a rating, up to one decimal.)

--------------------------------------------------------------------------------

GOAL:
- "find me new movies that I haven't watched" (optional input filters ie. genre) - uses backend system to find related movies, via embeddings, or third party APIs. Ideally later it would use our own MCP server with our own movie DB.

--------------------------------------------------------------------------------

These rough notes are my basic ideas. I am probably missing a bunch of features. I need you to fill those in.
I just want a better way to organize my movies (locally, from folders), serve them, watch them from a different computer, see their reviews and ratings, rate them on my own (internally), and find other related movies based on my existing collection and ratings, plus extra abilities to search torrents, etc.

I need you to analyze these features, and first sort them out into stages, then design a high level plan for the entire architecture: both the self-hosted server, the database on that server, the web ui for it that is accessible remotely, the streaming services to watch the movies remotely. Plus I want to be able to view my playlists, watched movies, find new movies, on the mobile phone version, that should connect to the same server (and show the same web app, just in a mobile version).
I need you to fill in any gaps in the feature set, for the "perfect" movie management, research, and self-hosted streaming application that users will want to use. It should be an "all in one" solution that works and is fairly efficient.
Design out the full feature set in a high-level plan, with brief instructions on how each feature and section should be implemented or organized/approached.
Lay out all features in the well-organized high-level plan, including any features that would be good to have or are necessary but not listed here.

Create the high level plan and put it here in ./.claude/plans/DEV_HIGH_LEVEL.md

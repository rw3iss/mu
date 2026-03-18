
# Movie Player improvements:

Make these minor changes to the seek bar and movie player:
	- Move the 'info' button in the player bar to the left of the 'volume' button.
	- Currently when clicking the volume button, the volume bar overlay shows, but then it jumps left a bit to center itself. Can you have it always centered above the button exactly? Also, can you find different volume icons, ie. for no volume, minimal volume (1 bar), medium volume, high volume? Then, when the user changes the volume, find the closest match icon to the volume (ie. 0% = off, 1-32% = 1 bar or low volume, 33-66% = 2 bars/medium volume, 66-100% = 3 bars).
	- Move the 'close' button to the upper right corner, instead, and in the upper left corner put a "minimize" down arrow, that the user can click to minimize the video the player bar.

Then we need to make these changes to the Movie player component, the seek bar, and how the movies are played globally, in order to support a minimized view, and allow them to continue playing while the user browses around the site.
	- Refactor the player so it is bar so it can support a "minimized" view. If the player is minimized (from the minimize icon click), then what should happen is:
		- The player component should still be loaded in the app, but not at the url or route level. Extract the player component so it can be loaded in it's own url (like it currently is), or as a standalone component we can control from other pages, sitting above the app.
		- The player component should become a global component which can listen to global player, or otherwise control the player from anywhere in the app (from the shown mini-player, or full player itself on the player page, will control it). When the /player/:movie-id page loads, if the user refreshes that page, or clicks a Play button from a movie page, it should just tell the global movie player to try to load and play that movie, and open the player page with the Movie Player component in full view, not the mini view.
		- The global Movie Player component should be modified to include the optional to switch it to 'full' or 'minimized' view. If it's full, it should operate as above. If the user clicks 'minimize' in the Movie Player, it should modify the UI by doing the following:
			- In the seek bar, create two columns, one on the right in a 16:9 ratio, where the mini video player will be moved to, and another column on the right, which should just be the existing entire player control bar (including all of the components: title, seek bar, and control buttons under it). When the player enters 'minimized' view, show the left column, and then hide the main video output (the top background/full video view) in the player, and instead, show the video player in the seek bar, in a small video output area in the new left column of the seek bar. If it is more efficient to just 'detach' and then 'move' the entire <video> element itself, from its existing full background position, to the new smaller seek bar positio when minimized, then just do that: move the html element itself to the new seek bar minimized position in the first left column, when it is minimized, so that the video element will just continue to play as if it were still in the background. If you know that we can reliably just "move" the html video element, and keep it playing in the play bar, when minimized, then let's try to do that. Otherwise, if it's not going to work that way good enough, then we can clone or make a new <video> element in the play bar, and control them separately during the minimize/maximize operations, but I'd like to try to use one <video> element, and one video stream, for the entire player (in max or mini view).
			- If the player is in the 'mini' view, then when they hover over the new mini player in the seek bar, show a semi-opaque "maximize" icon (ie. an up arrow, opposite of the minimize icon in the full view), and when the user clicks the 'mini' video in the seek bar, it should then change the player back to 'full mode', where the mini <video> player is then moved back to the full background area where it was, and the seek bar's left mini column is then hidden, so the movie player bar returns to its "normal" view.

		If the user minimizes a player, when playing, they should still be able to navigate around the site, and the player bar and movie should continue to play in the bottom of the app. So we need to be sure the new refactored Movie Player component will be global, and will just load a movie, and continue to play it. Again, the state of the player will only be controlled from the player bar itself. If the user clicks 'maximize' on the minimized player bar, when they are on some other page, the site should route back to that movie's original "/player/:movie-id" url, and show the movie player in full mode. In this way, the Movie Player can just operate independently of the rest of the site, but it should be a global component. It needs a way for the Movie pages, or other pages, to override the currently playing movie (ie. if the user clicks 'Play' on a different movie page, it should stop playing the previous movie, unload it, and begin loading the new movie and play it). If the user clicks 'play' on any video on the site, and the Movie Player component is already open for another video in 'minimized' view, the Movie Player should unload the old video, open the Movie Player in full view (change its mode), then load the new movie and start playing it. For the different pages or components to communicate that, we need a way for them to talk to the global Movie Player component. For that, create a well-architected hook system, that can override the currently playing movie, or control it, and maintain a state for the global player (you can use a modular global "moviePlayer store" or state to manage it). We want to persist this state in localstorage (ie. the currently loaded movie, its position, if it's playing, volume, etc), so create a way for the entire Movie Player to persist its current state to local storage whenver the data or state changes for it, using the global movie player store as a middle layer, which should use our existing cache/localstorage persistence mechanisms. Then have it restore that state when the page refreshed or the app reloads, so the global Movie Player will show again, in whatever mode it was in (normal or mini) when the app reloads, if the user refreshes the page, etc. Make the movie player can restore its own state, and continue where it left off, when it loads.

Can you refactor the player to work in a hybrid way like that, as an independent component that can be controlled in a custom way, and work in mini and full mode?

--------------------------------------------------------------------------------

- I'd like you to add a new movie-specific play configuration overrides on the Movie Details page.
In the Movie Details page, add a section above "File Info" called "Play Settings', similarly expandable.
The Play Settings section should over default overrides that the user wants to always use when playing that movie.
In the play settings, the user should be able optionally select:
- an eq profile to automatically load when the movie is played (load the current eq profiles into a dropdown).
- a similar compressor profile to automatically load when the movie is played.
- maybe some other settings here for play overrides, if you can think of any, but otherwise can add more later

When the user 'saves' the movie, after setting play setting overrides, they should save in a new "play_settings" column on the movies.
When the global movie player is asked to play any new movie, the movie details that it receives should also include the 'play_settings', and the player on the server and client should both detect if it needs to override any play settings from the given configuration options, if any exist. This means that... if the client starts playing the movie, and "play_settings" exist that define an eq profile, or compressor profile, to use during playback for that movie, then the player should automatically:
- enable that effect (ie. eq or compressor), if a profile is given
- load the movie's eq or compressor "saved" profile, if one is given in its play_settings (if the profile cannot be found, show a toast error that the profile no longer exists, and will be removed from the movie settings).

---------------------



Back/Forward extended time operation changes:
On the global movie player control bar, it currently has the -10s and +10s buttons.
Can we change these to be special rollover buttons, so when they user hovers over one of those buttons, extended timing options extend to the right of left of that button, with other time options?
First, change the default icons to a simple "back" and forward" icons, with no time indication.
Then, when the user hovers over one, for example the left "back" button, animate open a new extended panel of buttons, over top of the current button, where the right-most button is a -5s time button, the button to the left of that is a -10s button, then a -20s button.
So when a user hovers over the "back" button, it gets replaced with:
[-20s] [-10s] [-5s]
three buttons, in its place. The new button rollover bar should display directly over top of the existing back button, while the user is hovering over it. So if they clicked the 'back' button while hovering directly, it would be pressing the -5s button, but the user should also be able to select one of the other buttons to the left of it (-10s or -20s), and the extended options should not disappear, so ensure they are part of the hover detection. The buttons should go back to the normal "back" button when hovering off the entire st of buttons for the back operations.
Do the same for the other side: the forward button. When hovering it, replace it with extended buttons: [+5s] [+10s] [+20s], to its right, while hovering

Make the button overlays appear with a fast animation, like blurring and sliding outward from the direction they extend, over top of the existing button, as the existing button fades behind the extended button row.

--------------------------------------------------------------------------------

Let's extend the back/forward flyout button functionality, to enable the ability for users to set custom timings for the buttons (ie. a back/forward skip time different than 5s, 10s, or 20s).
Enable this new setting in the Settings > Playback page, under the Buffer size setting.
This setting should let the user define second values, as integers, for each of the three skip times.
Show three number inputs in this setting, for each button space, starting at a default of 5s, then 10s, then 20s.
Show the 'reset setting' button after the inputs to set the values back to those.
The user should be able to enter any value from 1 to 300 (1 second to 5 minutes).

This setting value should be requested and supplied to the app and global player during app initialization, and updated anytime the user might change the setting.
When the global player loads, it should show the custom values in the buttons, and skip the movie forward or back according to those configured times in the setting.

--------------------------------------------------------------------------------

- fix subtitles
Currently there seems to be an issue with subtitles.
When I 'search' in the subtitles open panel, for a movie, it always comes back with 'No subtitles found online'
I recently added the omdb and tmdb api keys. I don't know if that will help. Otherwise, can you check the backend subtitle search code to ensure it will search for subtitles, using the movie's current latest metadata (ie. it's real movie info), that it should have?
If it doesn't have the metadata/real movie info, it can try to search by filename.

Also, there is another bug: When I try to 'Upload' a subtitle file manually, it always shows this error: Internal server error
(to ie. url: http://mu.ryanweiss.net/api/v1/subtitles/5e5b7ed4-67fb-4d43-8f97-3201c81f4bd0/upload)

Can you login to the rw-win server, possibly, and diagnose the logs?

Locally, the error is similar if it is a remotely played movie (from a remote library). It shows:
No available file for movie remote:c9c69f1e-d145-4e44-8099-17cc9fde0a51:03c4e2cb-3a39-48c3-8dda-af69de5d31ae

However, locally, if it's a local movie (not from a remote server), the subtitle upload seems to work okay.
Can you fix it for the remote uploads, and the otherwise non-remote production environment?

You can check the local logs here for more info.

--------------------------------------------------------------------------------
There is some playback bug going on:
Sometimes movies seem to stop streaming, and then say 'transcoding in progress'. The network requests show 'segment not available'. Then, if I refresh the page, that movie still doesn't load and won't play, no matter what I try. If I change the movie entirely, and starting playing a different movie, it works, and works if I go back to the previous movie.
We need to make the streaming sort of smarter so that if it detects that it is failing, or a transcoding error, it should try to unload and reload the video, possibly, or do what it does at the 'new play' sequence, because the transcoding should be ready (it works if i start playing it after switching to another video), but for some reason if it's already being played, the transcoding gets "off track", and thinks its not ready ever...

Before we improve that stage, we also need to make sure that any currently streaming movies maintain a 'priority' as far as their transcoding and background jobs go. Is there anyway we can do that?
There should be a sort of "priority queue" for each movie session, and the first session that is playing should have the highest priority, so that its jobs and streaming requests will always try to be fulfilled first, so any playing videos will never pause or skip.
Is it possible to gain any benefit there, ie. to introduce prioritization in the jobs or transcoding, or does it not matter (maybe they aren't job based)? Otherwise, maybe we can give their threads a higher priority, somehow?
Is it possible to make a setting that tells the server what priority to run its background processes in, that can work on all platforms?

Research and implement the best way to ensure streams are prioritized and will have the least chance of skipping or missing requests for currently playing movies.
Then also ensure if a pause does happen that it will be able to smoothyl resume playback as fast as possibly, and not get stuck on "Segment not available" (when it shows), and if it encounters a state it cannot recover from, it should try to reload the movie at the currently playing position, as a last resort, if that would help.


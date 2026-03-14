- Setting to show history in sidepanel:

I'd like you to add a new Settings section 'Appearance', under the Library item.
Move the 'Theme' and 'Accent Color' settings that are currently in the General tab to there.
Also, for the accent color setting: currently it shows the custom swatch at the end of the row of colors.
Can you instead... combine that swatch with the first swatch (the + swatch), and set the custom swatches chosen color to its background color?
When that same + swatch is clicked it should open the color picker, and if the user changes the color, change the background color of the + swatch in the beginning to that color, as the selected Accent Color.

In the new Appearance section, add a setting to enable showing "Recently Played" items in the sidebar, enabled by default.
Ensure the settings is propagated in the backend and api, etc, as well as the reorganizing of the other settings.

Then, create a new 'Recently Played' sidebar component, that will show at the bottom of the sidebar (above the logout/user section in the footer), if the setting is enabled.
This component should list row items from the user's play history, with most recently played at the top.
Each item should show a small thumbnail/posted for it, the title, its year under it, and a play button.
Clicking the item itself should navigate to that movie page.
Clicking the play button should open it in the player, like any play button should.
Add a small icon arrow button in the center top of the recently played list to be able to 'collapse' the recently played history panel, then toggle the arrow upwards and enable it to open the panel back up if clicked again.

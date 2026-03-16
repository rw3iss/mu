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

--------------------------------------------------------------------------------

I'd like to make another setting for users to configure the card or item gap spacing around the site.
Make a new setting in the Settings page > Appearance tab, called 'Item Spacing', and allow for a static list of options for it, where each name corresponds to the gap values the items should use for themselves (approximately, you can convert these values to more response values if you want):
- None (0px)
- Minimal
- Compact
- Normal
- Comfortable
- Spaced

Ensure this setting can be configured, then, integrate it into all of the pages of the site that use any kind of itemized listing or card layout, ie:
- Dashboard page
- Library page
- Discover page
- Playlists page items
- Watchlist
- History

On the Library page, also integrate the gap setting into the 'list view' mode, to act as a gap between the list items themselves. The list items need to be broken out into their own rows, outside of their current container.
On the Playlists page, in the list mode, the gap can be applied to the items in the playlists themselves (their horizontal spacing), and not the playlists. Otherwise, if in 'card' mode on the Playlists page, it should lay the playlists out according to the gap (and not their items).

By default, these pages and area should use the current gap setting, if no override is set in the app's Appearance settings.

--------------------------------------------------------------------------------

I'd like to also expose more options, similarly, to customize the app's colors a bit.
These types of appearance settings can work in the same way that you implemented the item gap and other style overrides (ie. set reactively on app init).

Add these new settings there, and integrate them into the backend:

- Item Radius (px): enter a number value from 0 to 30 pixels. This number should be applied to the card items throughout the side, as their item radius.
- Card Border: Open a custom 'border editor' panel, where the user can define the border thickness, and select the color, with opacity, from a color picker. The output format should be a 'border' css value, which you can generate through utilities using the custom border configuration format that the panel can use, if it needs to.
- Page Background: The main app or page background color.
- Panel Background custom swatch to select a color for the different panels on the site (ie. the sidebar background, top header and logo background, the card/item backgrounds, etc).
- Disable Hover Effects: boolean toggle option, when enabled, the card items, when hovering, show not animate (ie. not expand their size any bigger).

Include a 'Reset' icon button next to all Appearance settings, that will reset that setting to the default.

Also fix bug in "Accent Color": when a custom color is selected in the first swatch, still show an overlay on the buton that it can be edited or changed, but with the background as the custom color.

Ensure all of the above settings are integrated into those various locations they should be applied to, around the entire site, using the same methods to persist and load it on app init as the item gap setting is doing.
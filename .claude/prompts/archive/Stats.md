
In the About section's Server Stats blocks, can you break apart these server stats into a more clean and formally separated layout?
Separate the blocks by their type, in more of a list or grid.
Put the Uptime label first, then below it put the CPU and Memory blocks, then to the right of those, put the disk usage blocks
Under those, put the 'current' blocks (Active streams, Transcodes, Running Jobs, Pending Jobs).

Can you also add a feature where when the user hovers over any of those blocks, it shows a tooltip immediately that explains what the statistic means? ie. each should say something about:
- CPU Load: This is how much the entire server is using for all processes currently
- Memory: How much the entire server is using
- App Data: This is how much space the server's ./data directory takes up, which is the size of the database, the thumbnails, metadata, and any cached data (transcodes, etc).
- Disk: how much disk is free on the entire machine
- Active Streams: what this means...
- etc...

Make it look like a more interesting and professional "statistics" panel layout and information set.


After you are done that, work on the thumbnail generation in the backend:
Make the thumbnail generation higher quality, at least double. The resolution of the thumbnails looks too blurry. When I play the video it is a higher resolution.
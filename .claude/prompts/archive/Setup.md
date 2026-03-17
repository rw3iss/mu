
I want to create an easier 'install' script for users to download the code, and deploy it onto their servers, ideally in a "one-click" kind of fashion.
The install script can be command line, or a small GUI utility, but it needs to be cross-platform, or separate versions for each platform (mac, linux, windows, and windows with git bash, etc).

For now let's create a command line install utility script, that users can download and run, ie. 'install.sh', or 'install.cmd', for example.

The interactive terminal should first try to install all prerequisites on that platform for this app, as necessary.
It should download the current release for the app code, at: https://github.com/rw3iss/cinehost/releases
Can you somehow fetch the latest release automatically, or do I need to tag it as 'latest'?
If I need to tag it as latest, let me know, otherwise you can use the 'v1.0-beta' release, configurable, or otherwise prompt the user which release they want to install by fetching the list of releases from the github repository, and displaying them in a selection list in the CLI prompt. That would be cool. Show the release date with the release names, if you can do that.

This should be an interactive terminal that asks some configuration questions, such as the install dir (default to somewhere reasonable for each machine such as /Applications, or C:/Program Files, etc), cache directory (default to current install .cache), and any other necessary setup or configuration details the application needs to start. It should ask and configure which port the server should run on, and if it should expose the port publically outside the network (ie. create a rule in the firewall), for that port.
If the user wants to open the port, it should do so on that platform.

Ensure the install scripts can setup the application for any platform, and show the status and output of each stage, and any error messages.
Create the install script now, and test it on a temporary directory on this platform, fixing errors as you see fit.

Then, if you want, you can login to the 'rw-win' aliased server, where the application is deployed, and try to test installing it there through the git bash, or windows command prompt as well, to a temporary directory, and different port than 4000, as a test (since it's already running the production server on 4000, or just stop the server to test).

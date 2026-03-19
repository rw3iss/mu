# ESOTERIC FIXES:


## ffmpeg process spawning failing sometimes on windows:

Found it. Line 150: spawn(command, args, options) — the options object includes windowsHide: true. On Windows, windowsHide: true creates the process with CREATE_NO_WINDOW flag. This prevents NVENC DLLs from initializing because NVIDIA's encoder DLL requires a window station/desktop handle during DllMain.

The fix is to patch the spawn call to not use windowsHide on Windows, or to override it in your transcoder service. Let me patch the transcoder to override the spawn behavior.

The cleanest fix is to patch fluent-ffmpeg's windowsHide at the module level. Let me add that to the transcoder service constructor.

--------------------------------------------------------------------------------


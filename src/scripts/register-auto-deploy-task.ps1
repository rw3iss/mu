# register-auto-deploy-task.ps1 — one-time setup of the Windows auto-deploy watcher.
#
# Registers a logon Scheduled Task ("Mu Auto Deploy") that runs
# src/scripts/auto-deploy-watch.sh under Git Bash, in the user's INTERACTIVE
# session at Highest privileges. Run once on the prod box:
#
#   powershell -ExecutionPolicy Bypass -File <path>\register-auto-deploy-task.ps1
#
# Idempotent: re-running replaces the existing task. Pass -Start to also kick it
# off immediately without waiting for the next logon.
param(
	[string]$DeployDir = 'C:\Users\rw3is\Documents\Sites\other\mu',
	[string]$TaskName  = 'Mu Auto Deploy',
	[switch]$Start
)

$ErrorActionPreference = 'Stop'

# Clean slate: stop the task and kill any lingering watcher instance so we never
# accumulate duplicates (concurrent watchers race on `git fetch` and on the
# server restart). Primary: the PID the watcher recorded. Fallback: bash
# processes whose command line runs the watcher script. Safe — neither touches
# unrelated bash/SSH sessions.
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
$pidFile = Join-Path $DeployDir 'data\auto-deploy.pid'
if (Test-Path $pidFile) {
	$oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($oldPid) {
		try { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue } catch {}
	}
}
Get-CimInstance Win32_Process -Filter "Name='bash.exe'" |
	Where-Object { $_.CommandLine -like '*auto-deploy-watch*' } |
	ForEach-Object {
		try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
	}

# Locate Git Bash.
$bashCandidates = @(
	'C:\Program Files\Git\bin\bash.exe',
	'C:\Program Files (x86)\Git\bin\bash.exe',
	"$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
)
$bash = $bashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) { throw "Could not find bash.exe in: $($bashCandidates -join ', ')" }

# Translate the Windows deploy dir to the MSYS path Git Bash expects.
$drive   = $DeployDir.Substring(0, 1).ToLower()
$rest    = $DeployDir.Substring(2).Replace('\', '/')
$scriptMsys = "/$drive$rest/src/scripts/auto-deploy-watch.sh"

Write-Host "Bash:    $bash"
Write-Host "Watcher: $scriptMsys"

# Launch the watcher fully DETACHED, in its own hidden console, via
# Start-Process. This is the crucial bit: a cmd-wrapped action shares a console
# with whatever triggers it, so an SSH-triggered Start-ScheduledTask tearing
# down — or the server restart's console CTRL_C — kills the watcher (exits
# 0xC000013A / CONTROL_C_EXIT right after "watcher started"). Detached, nothing
# can signal it. The task action exits immediately (task shows Ready); the
# watcher keeps running independently and logs to data/logs/auto-deploy.log.
# `-l` gives a login shell so node / pnpm / git are on PATH.
$psLaunch = "Start-Process -FilePath '$bash' -ArgumentList @('-l','$scriptMsys') -WindowStyle Hidden"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
	-Argument "-NoProfile -WindowStyle Hidden -Command `"$psLaunch`""
Write-Host "Action:  powershell -Command $psLaunch"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
# Long-running loop: no time limit, restart if it ever dies, only on AC is fine
# but allow battery too so it never silently stops.
$settings = New-ScheduledTaskSettingsSet `
	-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
	-ExecutionTimeLimit ([TimeSpan]::Zero) `
	-RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
	-MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
	-Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' (logon, interactive, highest)."

if ($Start) {
	Start-ScheduledTask -TaskName $TaskName
	Write-Host "Started '$TaskName'."
}

#requires -Version 5.1
<#
.SYNOPSIS
  Mu — self-hosted movie streaming. Windows installer.

.DESCRIPTION
  One-line install (PowerShell, run as a normal user — UAC will prompt
  when an action genuinely needs admin):

    iwr -useb https://raw.githubusercontent.com/rw3iss/mu/main/install.ps1 | iex

  Or pass flags:

    & ([scriptblock]::Create((iwr -useb https://.../install.ps1))) -Reinstall
    & ([scriptblock]::Create((iwr -useb https://.../install.ps1))) -Uninstall

.PARAMETER Reinstall
  Update an existing install in place. Preserves data by default.

.PARAMETER Uninstall
  Remove the install; prompts about keeping data / DB / cache.

.PARAMETER Yes
  Non-interactive — accept all defaults.

.PARAMETER InstallDir
  Install directory (default: $HOME\mu).

.PARAMETER Branch
  Git branch to install (default: main).
#>

param(
    [switch]$Reinstall,
    [switch]$Uninstall,
    [switch]$Yes,
    [string]$InstallDir = "$HOME\mu",
    [string]$Branch     = "main"
)

$ErrorActionPreference = "Stop"

# ── Constants ─────────────────────────────────────────────────────────────
$RepoUrl       = "https://github.com/rw3iss/mu.git"
$DefaultPort   = 4000
$DefaultJobs   = 2
$MinNodeMajor  = 20

# ── Helpers ───────────────────────────────────────────────────────────────
function Write-Step($t)  { Write-Host "`n$t" -ForegroundColor Magenta }
function Write-OK($t)    { Write-Host "  [+] $t" -ForegroundColor Green }
function Write-WarnX($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Write-Err($t)   { Write-Host "  [x] $t" -ForegroundColor Red }
function Write-Info($t)  { Write-Host "  [i] $t" -ForegroundColor Cyan }

function Read-Default {
    param([string]$Question, [string]$Default = "")
    if ($script:NonInteractive) { return $Default }
    $hint = if ($Default) { " [$Default]" } else { "" }
    $value = Read-Host "  $Question$hint"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default } else { return $value }
}

function Confirm-Default {
    param([string]$Question, [string]$Default = "Y")
    if ($script:NonInteractive) { return $Default -eq "Y" }
    $hint = if ($Default -eq "Y") { "[Y/n]" } else { "[y/N]" }
    $ans = Read-Host "  $Question $hint"
    if ([string]::IsNullOrWhiteSpace($ans)) { $ans = $Default }
    return $ans -match '^(y|yes)$'
}

function Banner {
    Write-Host @"

  +----------------------------------------------+
  |                  Mu                          |
  |      Self-hosted Movie Streaming             |
  +----------------------------------------------+

"@ -ForegroundColor Magenta
}

function Have-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# ── Winget bootstrap ──────────────────────────────────────────────────────
function Ensure-Winget {
    if (Have-Cmd winget) { return }
    Write-WarnX "winget not found. Install 'App Installer' from the Microsoft Store, then re-run."
    throw "winget required"
}

function Winget-Install($id) {
    Write-Info "winget install $id"
    winget install -e --id $id --silent --accept-package-agreements --accept-source-agreements
}

# ── Prerequisites ─────────────────────────────────────────────────────────
function Ensure-Git {
    if (Have-Cmd git) { return }
    Winget-Install "Git.Git"
    $env:Path += ";$Env:ProgramFiles\Git\cmd"
}

function Ensure-Node {
    if (Have-Cmd node) {
        $major = [int]((node -p "process.versions.node.split('.')[0]") 2>$null)
        if ($major -ge $MinNodeMajor) { Write-OK "node $(node -v)"; return }
        Write-WarnX "node $(node -v) older than required ($MinNodeMajor); upgrading"
    }
    Winget-Install "OpenJS.NodeJS.LTS"
    # Refresh PATH so the freshly-installed `node` resolves in this session.
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + `
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Ensure-Pnpm {
    if (Have-Cmd pnpm) { Write-OK "pnpm $(pnpm -v)"; return }
    if (Have-Cmd corepack) {
        corepack enable | Out-Null
        corepack prepare pnpm@latest --activate | Out-Null
    }
    if (-not (Have-Cmd pnpm)) {
        npm install -g pnpm
    }
    Write-OK "pnpm $(pnpm -v)"
}

function Ensure-FFmpeg {
    if (Have-Cmd ffmpeg) { Write-OK "ffmpeg present"; return }
    # Standard install location used by the rest of the project.
    $target = "C:\ffmpeg"
    if (Test-Path "$target\ffmpeg.exe") { Write-OK "ffmpeg at $target"; return }
    Write-Info "Installing FFmpeg via winget"
    Winget-Install "Gyan.FFmpeg" 2>$null
    # winget puts it in WinGet's links dir — copy or symlink into C:\ffmpeg
    # so the project's hard-coded auto-detect picks it up.
    $wingetFFmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue)?.Source
    if ($wingetFFmpeg -and -not (Test-Path "$target\ffmpeg.exe")) {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Copy-Item -Force $wingetFFmpeg "$target\ffmpeg.exe"
        Write-OK "ffmpeg → $target\ffmpeg.exe"
    }
}

# ── Config prompts ────────────────────────────────────────────────────────
$script:Conf = @{}

function Phase-Configure {
    Write-Step "Configuration"
    Write-Info "Press Enter to accept the default."
    Write-Info "Install directory: $InstallDir"

    $script:Conf.DataDir    = Read-Default "Data directory (database, cache, logs)" "$InstallDir\data"
    $script:Conf.MediaDir   = Read-Default "Initial media directory to scan" "$HOME\Videos\Movies"
    $script:Conf.Port       = Read-Default "HTTP server port" $DefaultPort
    $script:Conf.Concurrent = Read-Default "Max concurrent jobs (raise on dedicated boxes)" $DefaultJobs
    $script:Conf.UseNssm    = (Have-Cmd nssm) -and (Confirm-Default "Install as a Windows service (via nssm)?" "Y")
    $script:Conf.StartNow   = Confirm-Default "Start Mu immediately after install?" "Y"

    Write-Info "Will use:"
    Write-Info "  Install dir : $InstallDir"
    Write-Info "  Data dir    : $($script:Conf.DataDir)"
    Write-Info "  Media dir   : $($script:Conf.MediaDir)"
    Write-Info "  Port        : $($script:Conf.Port)"
    Write-Info "  Concurrent  : $($script:Conf.Concurrent)"
    Write-Info "  Service     : $(if ($script:Conf.UseNssm) {'nssm'} else {'none'})"
    Write-Info "  Start now   : $($script:Conf.StartNow)"
    if (-not (Confirm-Default "Proceed?" "Y")) { throw "Aborted by user." }
}

# ── Clone / build / migrate ───────────────────────────────────────────────
function Phase-Fetch {
    Write-Step "Fetching Mu source"
    if (Test-Path "$InstallDir\.git") {
        Push-Location $InstallDir
        git fetch origin $Branch
        git checkout $Branch
        git pull --ff-only
        Pop-Location
    } elseif ((Test-Path $InstallDir) -and ((Get-ChildItem $InstallDir).Count -gt 0)) {
        throw "$InstallDir is not empty. Use -Reinstall or pick a different -InstallDir."
    } else {
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        git clone --branch $Branch --depth 1 $RepoUrl $InstallDir
    }
}

function Phase-Build {
    Write-Step "Installing dependencies & building"
    Push-Location "$InstallDir\src"
    try {
        pnpm install --frozen-lockfile 2>$null
        if ($LASTEXITCODE -ne 0) { pnpm install }
        pnpm build
    } finally { Pop-Location }
}

function Phase-ConfigFile {
    Write-Step "Writing config + applying migrations"
    $dataDir   = $script:Conf.DataDir
    $configDir = Join-Path $dataDir "config"
    New-Item -ItemType Directory -Force -Path (Join-Path $dataDir "db")     | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $dataDir "logs")   | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $dataDir "cache")  | Out-Null
    New-Item -ItemType Directory -Force -Path $configDir                    | Out-Null

    $configFile = Join-Path $configDir "config.yml"
    if (Test-Path $configFile) {
        Write-Info "Existing config preserved at $configFile"
    } else {
        $jwt    = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
        $cookie = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
        $yaml = @"
# Mu config — generated $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
server:
  host: "0.0.0.0"
  port: $($script:Conf.Port)
  logLevel: info
auth:
  jwtSecret: "$jwt"
  cookieSecret: "$cookie"
  allowRegistration: true
dataDir: "$($dataDir -replace '\\','/')"
mediaSources:
  - path: "$($script:Conf.MediaDir -replace '\\','/')"
    name: "Default"
transcoding:
  hwAccel: none
  maxConcurrent: $($script:Conf.Concurrent)
cache:
  type: memory
thirdParty:
  tmdb:
    apiKey: ""
  omdb:
    apiKey: ""
  opensubtitles:
    apiKey: ""
jobs:
  backend: in-memory
"@
        Set-Content -Path $configFile -Value $yaml -Encoding UTF8
        Write-OK "Wrote $configFile"
    }

    Push-Location "$InstallDir\src"
    try {
        $env:MU_DATA_DIR = $dataDir
        pnpm db:migrate
    } finally { Pop-Location }
}

# ── Service (NSSM) ────────────────────────────────────────────────────────
function Phase-Service {
    if (-not $script:Conf.UseNssm) { return }
    Write-Step "Installing Windows service via nssm"
    $nodeBin = (Get-Command node).Source
    $entry   = "$InstallDir\src\packages\server\dist\main.js"
    nssm install mu-server $nodeBin $entry
    nssm set    mu-server AppDirectory "$InstallDir\src\packages\server"
    nssm set    mu-server AppStdout    "$($script:Conf.DataDir)\logs\server.log"
    nssm set    mu-server AppStderr    "$($script:Conf.DataDir)\logs\server.log"
    nssm set    mu-server AppEnvironmentExtra "NODE_ENV=production" "MU_DATA_DIR=$($script:Conf.DataDir)"
    nssm set    mu-server Start SERVICE_AUTO_START
    Write-OK   "nssm service 'mu-server' installed"
}

function Phase-Start {
    if (-not $script:Conf.StartNow) { return }
    Write-Step "Starting Mu"
    if ($script:Conf.UseNssm) {
        nssm start mu-server
        Write-OK "nssm: mu-server started"
        return
    }
    # Otherwise launch detached.
    $nodeBin = (Get-Command node).Source
    $entry   = "$InstallDir\src\packages\server\dist\main.js"
    Start-Process -FilePath $nodeBin -ArgumentList $entry `
        -WorkingDirectory "$InstallDir\src\packages\server" `
        -RedirectStandardOutput "$($script:Conf.DataDir)\logs\server.log" `
        -RedirectStandardError  "$($script:Conf.DataDir)\logs\server.log" `
        -WindowStyle Hidden
    Write-OK "Started (background process)"
}

# ── Finish messaging ──────────────────────────────────────────────────────
function Get-LanIp {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^(127|169\.254|0\.)' } |
        Select-Object -First 1 -ExpandProperty IPAddress
    return $ip
}

function Phase-Finish {
    $lan = Get-LanIp
    Write-Step "Done"
    Write-Host ""
    Write-Host "  Mu is installed." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Open the app:"
    Write-Host "    http://localhost:$($script:Conf.Port)"
    if ($lan) { Write-Host "    http://${lan}:$($script:Conf.Port)  (from other devices on this LAN)" }
    Write-Host ""
    Write-Host "  Update / reinstall:"
    Write-Host "    iwr -useb https://raw.githubusercontent.com/rw3iss/mu/main/install.ps1 | iex; iex 'install.ps1 -Reinstall'"
    Write-Host ""
    Write-Host "  Uninstall:"
    Write-Host "    iwr -useb https://raw.githubusercontent.com/rw3iss/mu/main/install.ps1 | iex; iex 'install.ps1 -Uninstall'"
    Write-Host ""
    if ($lan) {
        Write-Host "  Want to access Mu from outside your home network?"
        Write-Host "    1. Log into your router (usually http://192.168.1.1)."
        Write-Host "    2. Find 'Port forwarding' / NAT / Virtual server."
        Write-Host "    3. Forward TCP $($script:Conf.Port) to:"
        Write-Host "         IP:   $lan"
        Write-Host "         Port: $($script:Conf.Port)"
        Write-Host "    4. Use DuckDNS / no-ip for a stable hostname if your WAN IP changes."
        Write-Host "    5. For HTTPS, front with Caddy or nginx for free Let's Encrypt certs."
        Write-Host ""
    }
}

# ── Uninstall ─────────────────────────────────────────────────────────────
function Phase-Uninstall {
    Write-Step "Uninstalling Mu"
    $dataDir = Join-Path $InstallDir "data"
    if (-not (Test-Path $dataDir)) {
        $dataDir = Read-Default "Data directory (couldn't auto-detect)" "$InstallDir\data"
    }

    # Stop service
    try {
        $svc = Get-Service mu-server -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Info "Stopping mu-server service…"
            nssm stop mu-server 2>$null
            if (Confirm-Default "Remove nssm service registration?" "Y") {
                nssm remove mu-server confirm
                Write-OK "Service removed"
            }
        }
    } catch {}

    $keepDb    = $false
    $keepCache = $false
    if (Test-Path (Join-Path $dataDir "db\mu.db")) {
        $keepDb = Confirm-Default "Keep the database file?" "N"
    }
    if (Test-Path (Join-Path $dataDir "cache")) {
        $keepCache = Confirm-Default "Keep the transcode/image cache?" "N"
    }

    if (Confirm-Default "Remove the install directory ($InstallDir)?" "Y") {
        if ($keepDb -or $keepCache) {
            $stash = "$HOME\mu-preserved-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            New-Item -ItemType Directory -Force -Path $stash | Out-Null
            if ($keepDb)    { Copy-Item -Recurse "$dataDir\db"    "$stash\db";    Write-OK "DB preserved at $stash\db" }
            if ($keepCache) { Copy-Item -Recurse "$dataDir\cache" "$stash\cache"; Write-OK "Cache preserved at $stash\cache" }
        }
        Remove-Item -Recurse -Force $InstallDir
        Write-OK "Removed $InstallDir"
    } else {
        Write-Info "Install dir preserved at $InstallDir"
    }
    Write-Step "Uninstall complete"
}

# ── Reinstall ─────────────────────────────────────────────────────────────
function Phase-Reinstall {
    Write-Step "Reinstalling Mu"
    if (-not (Test-Path $InstallDir)) {
        Write-WarnX "$InstallDir doesn't exist — falling through to fresh install."
        return $false
    }
    Push-Location $InstallDir
    git fetch origin $Branch
    git checkout $Branch
    git pull --ff-only
    Pop-Location

    Push-Location "$InstallDir\src"
    try {
        pnpm install --frozen-lockfile 2>$null
        if ($LASTEXITCODE -ne 0) { pnpm install }
        pnpm build
        $env:MU_DATA_DIR = (Join-Path $InstallDir "data")
        pnpm db:migrate
    } finally { Pop-Location }

    try {
        $svc = Get-Service mu-server -ErrorAction SilentlyContinue
        if ($svc) { nssm restart mu-server; Write-OK "Service restarted" }
    } catch {}
    Write-OK "Reinstall complete"
    return $true
}

# ── Main ──────────────────────────────────────────────────────────────────
$script:NonInteractive = [bool]$Yes
Banner
Write-Info "Platform: Windows"

if ($Uninstall) {
    Phase-Uninstall
    exit 0
}

if ($Reinstall) {
    if (Phase-Reinstall) { exit 0 }
}

Write-Step "Prerequisites"
Ensure-Winget
Ensure-Git
Ensure-Node
Ensure-Pnpm
Ensure-FFmpeg

Phase-Configure
Phase-Fetch
Phase-Build
Phase-ConfigFile
Phase-Service
Phase-Start
Phase-Finish

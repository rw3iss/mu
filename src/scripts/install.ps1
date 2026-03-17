#Requires -Version 5.1
<#
.SYNOPSIS
    CineHost Install Wizard for Windows (PowerShell)
.DESCRIPTION
    Interactive installer for CineHost self-hosted movie streaming server.
    Checks prerequisites, downloads a release from GitHub, builds, and configures.
#>

$ErrorActionPreference = "Stop"

$GitHubRepo = "rw3iss/cinehost"
$GitHubApi  = "https://api.github.com/repos/$GitHubRepo"
$MinNode    = 20
$MinPnpm    = 9
$MinFFmpeg  = 5

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg)    { Write-Host "`n$msg" -ForegroundColor Magenta -NoNewline; Write-Host "" }
function Write-Ok($msg)      { Write-Host "  [+] $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "  [x] $msg" -ForegroundColor Red }
function Write-Info($msg)    { Write-Host "  [i] $msg" -ForegroundColor Cyan }

function Prompt-Value($text, $default) {
    Write-Host "  $text [$default]: " -ForegroundColor Cyan -NoNewline
    $val = Read-Host
    if ([string]::IsNullOrWhiteSpace($val)) { return $default } else { return $val }
}

function Prompt-YesNo($text, $defaultYes = $false) {
    $suffix = if ($defaultYes) { "(Y/n)" } else { "(y/N)" }
    Write-Host "  $text $suffix`: " -ForegroundColor Cyan -NoNewline
    $val = (Read-Host).Trim().ToLower()
    if ([string]::IsNullOrWhiteSpace($val)) { return $defaultYes }
    return ($val -eq "y" -or $val -eq "yes")
}

function Test-CommandVersion($cmd, $minMajor, $versionArg = "--version") {
    try {
        $output = & $cmd $versionArg 2>&1 | Select-Object -First 1
        if ($output -match '(\d+)') {
            return [int]$Matches[1] -ge $minMajor
        }
    } catch {}
    return $false
}

function Get-CommandPath($cmd) {
    try { return (Get-Command $cmd -ErrorAction Stop).Source } catch { return $null }
}

# ── Banner ───────────────────────────────────────────────────────────────────

function Show-Banner {
    Write-Host ""
    Write-Host "  +=============================================+" -ForegroundColor White
    Write-Host "  |                                             |" -ForegroundColor White
    Write-Host "  |          CineHost Install Wizard            |" -ForegroundColor White
    Write-Host "  |     Self-Hosted Movie Streaming Server      |" -ForegroundColor White
    Write-Host "  |                                             |" -ForegroundColor White
    Write-Host "  +=============================================+" -ForegroundColor White
    Write-Host ""
}

# ── Phase 1: Prerequisites ──────────────────────────────────────────────────

function Install-NodeJS {
    $hasWinget = Get-CommandPath "winget"
    if ($hasWinget) {
        Write-Info "Installing Node.js via winget..."
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    } else {
        Write-Info "Downloading Node.js installer..."
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $url = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-$arch.msi"
        $msi = Join-Path $env:TEMP "nodejs-install.msi"
        Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
        Write-Info "Running Node.js installer..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /passive /norestart" -Wait
        Remove-Item $msi -Force -ErrorAction SilentlyContinue
    }
    # Refresh PATH
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
}

function Install-Pnpm {
    Write-Info "Installing pnpm..."
    npm install -g pnpm@latest 2>&1 | Select-Object -Last 3
}

function Install-FFmpeg {
    $hasWinget = Get-CommandPath "winget"
    if ($hasWinget) {
        Write-Info "Installing FFmpeg via winget..."
        winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
    } else {
        Write-Info "Downloading FFmpeg..."
        $url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
        $zip = Join-Path $env:TEMP "ffmpeg.zip"
        $dest = "C:\ffmpeg"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $dest -Force
        # Move binaries from nested dir
        $inner = Get-ChildItem $dest -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1
        if ($inner) {
            Copy-Item "$($inner.FullName)\bin\*" $dest -Force
        }
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        # Add to PATH for this session
        $env:PATH = "$dest;$env:PATH"
        Write-Info "FFmpeg installed to $dest"
        Write-Info "Add C:\ffmpeg to your system PATH for permanent access."
    }
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")
}

function Check-Prerequisites {
    Write-Step "Phase 1: Checking prerequisites"

    # Node.js
    if (Test-CommandVersion "node" $MinNode "-v") {
        $v = (node -v 2>&1).Trim()
        Write-Ok "Node.js $v detected"
    } else {
        if (Get-CommandPath "node") {
            $v = (node -v 2>&1).Trim()
            Write-Warn "Node.js $v detected, but v${MinNode}+ is required."
        } else {
            Write-Warn "Node.js not found."
        }
        if (Prompt-YesNo "Install Node.js automatically?" $true) {
            Install-NodeJS
            if (Test-CommandVersion "node" $MinNode "-v") {
                $v = (node -v 2>&1).Trim()
                Write-Ok "Node.js $v installed"
            } else {
                Write-Err "Node.js installation failed. Install v${MinNode}+ from https://nodejs.org"
                exit 1
            }
        } else {
            Write-Err "Node.js ${MinNode}+ is required."
            exit 1
        }
    }

    # pnpm
    if (Test-CommandVersion "pnpm" $MinPnpm "-v") {
        $v = (pnpm -v 2>&1).Trim()
        Write-Ok "pnpm $v detected"
    } else {
        Write-Info "Installing pnpm..."
        Install-Pnpm
        if (Test-CommandVersion "pnpm" $MinPnpm "-v") {
            $v = (pnpm -v 2>&1).Trim()
            Write-Ok "pnpm $v installed"
        } else {
            Write-Err "pnpm installation failed."
            exit 1
        }
    }

    # FFmpeg
    if (Test-CommandVersion "ffmpeg" $MinFFmpeg "-version") {
        $v = (ffmpeg -version 2>&1 | Select-Object -First 1) -replace '.*version\s+(\S+).*','$1'
        Write-Ok "FFmpeg $v detected"
    } else {
        Write-Warn "FFmpeg ${MinFFmpeg}+ not found. Required for video transcoding."
        if (Prompt-YesNo "Install FFmpeg automatically?") {
            Install-FFmpeg
            if (Get-CommandPath "ffmpeg") {
                Write-Ok "FFmpeg installed"
            } else {
                Write-Warn "FFmpeg may require reopening your terminal."
            }
        } else {
            Write-Warn "Skipping FFmpeg -- streaming/transcoding won't work without it."
        }
    }

    Write-Host ""
    Write-Ok "Prerequisites check complete"
}

# ── Phase 2: Release Selection ───────────────────────────────────────────────

$script:SelectedTag = ""
$script:SelectedDate = ""
$script:SelectedZipball = ""

function Select-Release {
    Write-Step "Phase 2: Select CineHost release"
    Write-Info "Fetching available releases..."

    $releases = Invoke-RestMethod -Uri "$GitHubApi/releases" -Headers @{ Accept = "application/vnd.github+json" } -UseBasicParsing

    if (-not $releases -or $releases.Count -eq 0) {
        Write-Err "No releases found."
        exit 1
    }

    Write-Host ""
    Write-Host "  Available CineHost Releases:" -ForegroundColor White
    Write-Host ""

    $i = 1
    foreach ($r in $releases) {
        $date = $r.published_at.ToString("yyyy-MM-dd")
        $label = if ($i -eq 1) { "  (latest)" } else { "" }
        $num = "{0,4}" -f "$i)"
        Write-Host "  $num  $($r.tag_name.PadRight(20))  $date" -NoNewline
        if ($label) { Write-Host $label -ForegroundColor Green -NoNewline }
        Write-Host ""
        $i++
    }

    Write-Host ""
    $choice = Prompt-Value "Select release" "1"
    $idx = [int]$choice - 1

    if ($idx -lt 0 -or $idx -ge $releases.Count) {
        Write-Err "Invalid selection."
        exit 1
    }

    $selected = $releases[$idx]
    $script:SelectedTag = $selected.tag_name
    $script:SelectedDate = $selected.published_at.ToString("yyyy-MM-dd")
    $script:SelectedZipball = $selected.zipball_url

    Write-Ok "Selected: $($script:SelectedTag) ($($script:SelectedDate))"
}

# ── Phase 3: Configuration ──────────────────────────────────────────────────

$script:InstallDir = ""
$script:DataDir = ""
$script:ServerPort = ""
$script:OpenFirewall = $false

function Configure-Install {
    Write-Step "Phase 3: Configure installation"

    $script:InstallDir = Prompt-Value "Install directory" "C:\cinehost"
    $script:DataDir = Prompt-Value "Data directory (database, cache, config)" "$($script:InstallDir)\data"

    do {
        $script:ServerPort = Prompt-Value "Server port" "4000"
    } while (-not ($script:ServerPort -match '^\d+$' -and [int]$script:ServerPort -ge 1 -and [int]$script:ServerPort -le 65535))

    $script:OpenFirewall = Prompt-YesNo "Open port $($script:ServerPort) in firewall for external access?"

    Write-Host ""
    Write-Host "  Configuration Summary:" -ForegroundColor White
    Write-Host "    Release:       $($script:SelectedTag)"
    Write-Host "    Install dir:   $($script:InstallDir)"
    Write-Host "    Data dir:      $($script:DataDir)"
    Write-Host "    Port:          $($script:ServerPort)"
    Write-Host "    Firewall:      $(if ($script:OpenFirewall) { 'open port' } else { 'no change' })"
    Write-Host ""

    if (-not (Prompt-YesNo "Proceed with installation?" $true)) {
        Write-Info "Installation cancelled."
        exit 0
    }
}

# ── Phase 4: Download & Extract ──────────────────────────────────────────────

function Download-Release {
    Write-Step "Phase 5: Downloading CineHost $($script:SelectedTag)"

    $tempDir = Join-Path $env:TEMP "cinehost-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $zipFile = Join-Path $tempDir "cinehost.zip"

    Write-Info "Downloading from GitHub..."
    Invoke-WebRequest -Uri $script:SelectedZipball -OutFile $zipFile -UseBasicParsing
    Write-Ok "Download complete"

    Write-Info "Extracting..."
    $extractDir = Join-Path $tempDir "extracted"
    Expand-Archive -Path $zipFile -DestinationPath $extractDir -Force

    $inner = Get-ChildItem $extractDir -Directory | Select-Object -First 1
    if (-not $inner) {
        Write-Err "Failed to extract release archive."
        exit 1
    }

    New-Item -ItemType Directory -Path $script:InstallDir -Force | Out-Null

    # The source code lives inside a src/ directory in the repo
    $srcDir = Join-Path $inner.FullName "src"
    if (Test-Path $srcDir) {
        Copy-Item "$srcDir\*" $script:InstallDir -Recurse -Force
        foreach ($f in @("README.md", "LICENSE")) {
            $fp = Join-Path $inner.FullName $f
            if (Test-Path $fp) { Copy-Item $fp $script:InstallDir -Force }
        }
    } else {
        Copy-Item "$($inner.FullName)\*" $script:InstallDir -Recurse -Force
    }

    # Cleanup temp
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "Extracted to $($script:InstallDir)"
}

# ── Phase 5: Build ───────────────────────────────────────────────────────────

function Build-Project {
    Write-Step "Phase 6: Building CineHost"
    Push-Location $script:InstallDir

    Write-Info "Installing dependencies (this may take a minute)..."
    try {
        pnpm install --frozen-lockfile 2>&1 | Select-Object -Last 5
    } catch {
        pnpm install 2>&1 | Select-Object -Last 5
    }
    Write-Ok "Dependencies installed"

    Write-Info "Building project..."
    pnpm build 2>&1 | Select-Object -Last 10
    Write-Ok "Build complete"

    Pop-Location
}

# ── Phase 6: Generate Config ────────────────────────────────────────────────

function Generate-Config {
    Write-Step "Phase 7: Generating configuration"

    $configDir = Join-Path $script:DataDir "config"
    foreach ($d in @(
        $script:DataDir,
        $configDir,
        (Join-Path $script:DataDir "db"),
        (Join-Path $script:DataDir "cache\images"),
        (Join-Path $script:DataDir "cache\streams"),
        (Join-Path $script:DataDir "thumbnails"),
        (Join-Path $script:DataDir "logs")
    )) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }

    $jwtSecret = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Minimum 0 -Maximum 256) })
    $cookieSecret = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Minimum 0 -Maximum 256) })

    # Use relative data dir if inside install dir
    $configDataDir = $script:DataDir
    if ($script:DataDir.StartsWith($script:InstallDir)) {
        $configDataDir = "." + $script:DataDir.Substring($script:InstallDir.Length).Replace("\", "/")
    }

    $thirdPartyBlock = ""
    if ($script:ApiKeyTmdb -or $script:ApiKeyOmdb -or $script:ApiKeyOpenSub) {
        $thirdPartyBlock = "`nthirdParty:"
        if ($script:ApiKeyTmdb) { $thirdPartyBlock += "`n  tmdb:`n    apiKey: `"$($script:ApiKeyTmdb)`"" }
        if ($script:ApiKeyOmdb) { $thirdPartyBlock += "`n  omdb:`n    apiKey: `"$($script:ApiKeyOmdb)`"" }
        if ($script:ApiKeyOpenSub) { $thirdPartyBlock += "`n  opensubtitles:`n    apiKey: `"$($script:ApiKeyOpenSub)`"" }
    }

    $configContent = @"
# CineHost configuration
# Generated by install script on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC")
# Override values with MU_ prefixed environment variables.

server:
  host: "0.0.0.0"
  port: $($script:ServerPort)

auth:
  jwtSecret: "$jwtSecret"
  cookieSecret: "$cookieSecret"

dataDir: "$configDataDir"

media:
  libraryPaths: []
$thirdPartyBlock
"@

    $configPath = Join-Path $configDir "config.yml"
    Set-Content -Path $configPath -Value $configContent -Encoding UTF8
    Write-Ok "Configuration saved to $configPath"
}

# ── Phase 4: API Keys ────────────────────────────────────────────────────────

$script:ApiKeyTmdb = ""
$script:ApiKeyOmdb = ""
$script:ApiKeyOpenSub = ""

function Configure-ApiKeys {
    Write-Step "Phase 4: API Keys"
    Write-Host ""
    Write-Info "API keys enable metadata fetching, ratings, and subtitle search."
    Write-Info "You can skip this step and configure keys later in the config file."
    Write-Host ""

    if (-not (Prompt-YesNo "Configure API keys now?" $true)) {
        Write-Info "Skipped -- features requiring API keys will be disabled until configured."
        return
    }

    while ($true) {
        Write-Host ""
        Write-Host "  API Keys:" -ForegroundColor White
        Write-Host ""

        if ($script:ApiKeyTmdb) {
            Write-Host "    1)  TMDB            " -NoNewline; Write-Host "(key: $($script:ApiKeyTmdb))" -ForegroundColor Green
        } else {
            Write-Host "    1)  TMDB            " -NoNewline; Write-Host "<not set>  https://www.themoviedb.org/settings/api" -ForegroundColor DarkGray
        }

        if ($script:ApiKeyOmdb) {
            Write-Host "    2)  OMDB / IMDb     " -NoNewline; Write-Host "(key: $($script:ApiKeyOmdb))" -ForegroundColor Green
        } else {
            Write-Host "    2)  OMDB / IMDb     " -NoNewline; Write-Host "<not set>  https://www.omdbapi.com/apikey.aspx" -ForegroundColor DarkGray
        }

        if ($script:ApiKeyOpenSub) {
            Write-Host "    3)  OpenSubtitles   " -NoNewline; Write-Host "(key: $($script:ApiKeyOpenSub))" -ForegroundColor Green
        } else {
            Write-Host "    3)  OpenSubtitles   " -NoNewline; Write-Host "<not set>  https://www.opensubtitles.com/consumers" -ForegroundColor DarkGray
        }

        Write-Host ""
        Write-Host "    d)  Done"
        Write-Host "    s)  Skip (configure later)"
        Write-Host ""

        Write-Host "  Select option: " -ForegroundColor Cyan -NoNewline
        $choice = Read-Host

        switch ($choice.Trim().ToLower()) {
            "1" {
                Write-Host "  Enter TMDB API key: " -ForegroundColor Cyan -NoNewline
                $val = (Read-Host).Trim()
                if ($val) { $script:ApiKeyTmdb = $val; Write-Ok "TMDB key set" }
            }
            "2" {
                Write-Host "  Enter OMDB API key: " -ForegroundColor Cyan -NoNewline
                $val = (Read-Host).Trim()
                if ($val) { $script:ApiKeyOmdb = $val; Write-Ok "OMDB key set" }
            }
            "3" {
                Write-Host "  Enter OpenSubtitles API key: " -ForegroundColor Cyan -NoNewline
                $val = (Read-Host).Trim()
                if ($val) { $script:ApiKeyOpenSub = $val; Write-Ok "OpenSubtitles key set" }
            }
            "d" { break }
            "s" {
                Write-Info "Skipped -- configure API keys later in config.yml"
                $script:ApiKeyTmdb = ""; $script:ApiKeyOmdb = ""; $script:ApiKeyOpenSub = ""
                break
            }
            default { Write-Warn "Invalid option" }
        }
    }

    $count = @($script:ApiKeyTmdb, $script:ApiKeyOmdb, $script:ApiKeyOpenSub) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
    Write-Ok "$count API key(s) configured"
}

# ── Phase 8: Firewall ───────────────────────────────────────────────────────

function Configure-Firewall {
    if (-not $script:OpenFirewall) { return }

    Write-Step "Phase 8: Opening firewall port $($script:ServerPort)"

    try {
        New-NetFirewallRule -DisplayName "CineHost" -Direction Inbound `
            -LocalPort $script:ServerPort -Protocol TCP -Action Allow `
            -ErrorAction Stop | Out-Null
        Write-Ok "Windows Firewall rule added"
    } catch {
        Write-Warn "Failed to add firewall rule: $($_.Exception.Message)"
        Write-Warn "Run PowerShell as Administrator, or add the rule manually."
    }
}

# ── Finish ───────────────────────────────────────────────────────────────────

function Show-Success {
    Write-Host ""
    Write-Host "  +=============================================+" -ForegroundColor Green
    Write-Host "  |   CineHost installed successfully!          |" -ForegroundColor Green
    Write-Host "  +=============================================+" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Version:    $($script:SelectedTag)"
    Write-Host "  Location:   $($script:InstallDir)"
    Write-Host "  Data:       $($script:DataDir)"
    Write-Host "  Config:     $(Join-Path $script:DataDir 'config\config.yml')"
    Write-Host "  Port:       $($script:ServerPort)"
    Write-Host ""
    Write-Host "  Start:      cd $($script:InstallDir); node packages\server\dist\main.js" -ForegroundColor Cyan
    Write-Host "  Open:       http://localhost:$($script:ServerPort)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  First visit: create your admin account at the setup page." -ForegroundColor DarkGray
    Write-Host "  Add media directories in Settings > Library after login." -ForegroundColor DarkGray
    Write-Host ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

Show-Banner
Write-Info "Platform: Windows ($([Environment]::OSVersion.Version))"

Check-Prerequisites
Select-Release
Configure-Install
Configure-ApiKeys
Download-Release
Build-Project
Generate-Config
Configure-Firewall
Show-Success

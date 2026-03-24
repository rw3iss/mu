<#
.SYNOPSIS
    GPU Performance Doctor — Windows PowerShell Edition
    Analyzes NVIDIA GPU encoding performance and offers optimizations.

.DESCRIPTION
    Run from any PowerShell or Windows Terminal. No Git Bash required.
    Usage:  .\gpu-doctor.ps1 [-Auto] [-ReportOnly] [-Json]

.PARAMETER Auto
    Apply all safe fixes without prompting.
.PARAMETER ReportOnly
    Print diagnostics only, no fix offers.
.PARAMETER Json
    Output machine-readable JSON report.
#>
param(
    [switch]$Auto,
    [switch]$ReportOnly,
    [switch]$Json
)

$ErrorActionPreference = "SilentlyContinue"
$Version = "1.0.0"

# ─── Colors ──────────────────────────────────────────────────────────────────
$UseColor = $Host.UI.SupportsVirtualTerminal -or ($env:WT_SESSION) -or ($env:TERM_PROGRAM)
if ($Json) { $UseColor = $false }

function C($code) { if ($UseColor) { "`e[${code}m" } else { "" } }
$R   = C "0"     ; $Bold = C "1"    ; $Dim  = C "2"
$Red = C "0;31"  ; $Grn  = C "0;32" ; $Yel  = C "0;33"
$Blu = C "0;34"  ; $Cyn  = C "0;36"

# ─── State ───────────────────────────────────────────────────────────────────
$script:Findings   = [System.Collections.ArrayList]::new()  # @{Sev; Cat; Msg; FixId}
$script:Fixes      = [System.Collections.ArrayList]::new()  # @{Id; Desc; Cmd}

# GPU globals
$script:GpuName = ""; $script:DriverVer = ""; $script:CudaVer = ""
$script:GpuTemp = 0;  $script:GpuPower = ""; $script:GpuPowerLimit = ""
$script:GpuPowerMax = ""; $script:GpuUtil = 0; $script:EncUtil = 0
$script:DecUtil = 0;  $script:EncSessions = 0
$script:GpuClock = 0; $script:GpuClockMax = 0; $script:VramUsed = 0; $script:VramTotal = 0
$script:FfmpegPath = ""; $script:FfmpegVer = ""
$script:HasNvenc = $false; $script:HasAv1Nvenc = $false; $script:HasCuvid = $false

# ─── Helpers ─────────────────────────────────────────────────────────────────
function Banner {
    if ($Json) { return }
    Write-Host ""
    Write-Host "$Bold${Cyn}+==============================================================+$R"
    Write-Host "$Bold${Cyn}|          GPU Performance Doctor  v${Version}                    |$R"
    Write-Host "$Bold${Cyn}|          Encoding Optimization Analyzer                      |$R"
    Write-Host "$Bold${Cyn}+==============================================================+$R"
    Write-Host ""
}

function Section($title) {
    if ($Json) { return }
    Write-Host ""
    Write-Host "$Bold${Blu}--- $title ---$R"
}

function Ok($msg)   { if (!$Json) { Write-Host "  ${Grn}[OK]${R} $msg" } }
function Warn($msg) { if (!$Json) { Write-Host "  ${Yel}[!!]${R} $msg" } }
function Err($msg)  { if (!$Json) { Write-Host "  ${Red}[XX]${R} $msg" } }
function Info($msg) { if (!$Json) { Write-Host "  ${Dim}[ .]${R} $msg" } }

function AddFinding($sev, $cat, $msg, $fixId) {
    [void]$script:Findings.Add(@{ Sev=$sev; Cat=$cat; Msg=$msg; FixId=$fixId })
}
function AddFix($id, $desc, $cmd) {
    [void]$script:Fixes.Add(@{ Id=$id; Desc=$desc; Cmd=$cmd })
}

function NvSmi {
    param([string[]]$Args)
    $paths = @(
        "nvidia-smi"
        "$env:SystemRoot\System32\nvidia-smi.exe"
        "${env:ProgramFiles}\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    )
    foreach ($p in $paths) {
        $result = & $p @Args 2>$null
        if ($LASTEXITCODE -eq 0 -or $result) { return $result }
    }
    return $null
}

function NvQuery($field) {
    $r = NvSmi @("--query-gpu=$field", "--format=csv,noheader,nounits")
    if ($r) { return ($r.Trim()) }
    return $null
}

# ─── Checks ──────────────────────────────────────────────────────────────────
function CheckGpu {
    Section "GPU Detection"

    $script:GpuName = NvQuery "gpu_name"
    if (-not $script:GpuName) {
        Err "nvidia-smi not found - no NVIDIA GPU detected or drivers not installed"
        AddFinding "critical" "gpu" "NVIDIA GPU not detected or drivers not installed" ""
        return $false
    }

    $script:DriverVer = NvQuery "driver_version"
    $smiOut = NvSmi @()
    $script:CudaVer = if ($smiOut) {
        ($smiOut | Select-String "CUDA Version" | ForEach-Object {
            $_ -replace '.*CUDA Version:\s*', '' -replace '\s.*', ''
        }) -join ""
    } else { "N/A" }

    Ok "GPU: $Bold$($script:GpuName)$R"
    Ok "Driver: $($script:DriverVer)  |  CUDA: $($script:CudaVer)"
    AddFinding "ok" "gpu" "NVIDIA GPU detected: $($script:GpuName) (driver $($script:DriverVer))" ""
    return $true
}

function CheckGpuHealth {
    Section "GPU Health & Thermals"

    $script:GpuTemp       = [int](NvQuery "temperature.gpu")
    $script:GpuPower      = NvQuery "power.draw"
    $script:GpuPowerLimit = NvQuery "power.limit"
    $script:GpuPowerMax   = NvQuery "power.max_limit"
    $fan                  = NvQuery "fan.speed"
    $pstate               = NvQuery "pstate"

    Info "Temperature: $($script:GpuTemp) C  |  Fan: ${fan}%  |  PState: $pstate"
    Info "Power: $($script:GpuPower)W / $($script:GpuPowerLimit)W limit (max $($script:GpuPowerMax)W)"

    # Temperature
    if ($script:GpuTemp -ge 85) {
        Err "GPU temperature is critically high ($($script:GpuTemp) C) - thermal throttling likely"
        AddFinding "critical" "thermal" "GPU at $($script:GpuTemp) C - improve cooling or reduce workload" ""
    } elseif ($script:GpuTemp -ge 75) {
        Warn "GPU temperature is elevated ($($script:GpuTemp) C) - monitor closely"
        AddFinding "warn" "thermal" "GPU at $($script:GpuTemp) C - consider improving airflow" ""
    } else {
        Ok "Temperature is healthy ($($script:GpuTemp) C)"
    }

    # Power headroom
    try {
        $limitVal = [double]($script:GpuPowerLimit -replace '[^\d.]','')
        $maxVal   = [double]($script:GpuPowerMax   -replace '[^\d.]','')
        if ($limitVal -lt $maxVal) {
            Warn "Power limit ($($script:GpuPowerLimit)W) below max ($($script:GpuPowerMax)W)"
            AddFinding "warn" "power" "GPU power limit below max - raising may improve perf" "fix_power_limit"
            AddFix "fix_power_limit" "Raise GPU power limit to $($script:GpuPowerMax)W" "nvidia-smi -pl $maxVal"
        } else {
            Ok "Power limit at maximum ($($script:GpuPowerLimit)W)"
        }
    } catch {}

    # Throttle detection
    $perfData = NvSmi @("-q", "-d", "PERFORMANCE") | Out-String
    $thermalThrottle = $perfData -match "HW Thermal Slowdown\s*:\s*Active"
    $powerThrottle   = $perfData -match "SW Power Cap\s*:\s*Active"
    $hwThrottle      = $perfData -match "HW Slowdown\s*:\s*Active"

    if ($thermalThrottle) {
        Err "THERMAL THROTTLING ACTIVE - GPU is overheating"
        AddFinding "critical" "thermal" "Thermal throttling active" ""
    }
    if ($powerThrottle) {
        Warn "Software power capping active"
        AddFinding "warn" "power" "SW power cap is throttling the GPU" "fix_power_limit"
    }
    if ($hwThrottle) {
        Err "Hardware slowdown active"
        AddFinding "critical" "throttle" "Hardware slowdown - check power supply and cooling" ""
    }
    if (-not $thermalThrottle -and -not $powerThrottle -and -not $hwThrottle) {
        Ok "No throttling detected"
    }
}

function CheckEncoder {
    Section "NVENC Encoder Status"

    $script:GpuUtil  = [int](NvQuery "utilization.gpu")
    $script:EncUtil  = [int](NvQuery "utilization.encoder")
    $script:DecUtil  = [int](NvQuery "utilization.decoder")
    $script:VramUsed = [int](NvQuery "memory.used")
    $script:VramTotal= [int](NvQuery "memory.total")

    $encData = NvSmi @("-q", "-d", "ENCODER_STATS") | Out-String
    if ($encData -match "Active Sessions\s*:\s*(\d+)") { $script:EncSessions = [int]$Matches[1] }
    $encFps = "N/A"; $encLat = "N/A"
    if ($encData -match "Average FPS\s*:\s*(\d+)") { $encFps = $Matches[1] }
    if ($encData -match "Average Latency\s*:\s*(\d+)") { $encLat = $Matches[1] }

    $script:GpuClock    = [int](NvQuery "clocks.current.graphics")
    $script:GpuClockMax = [int](NvQuery "clocks.max.graphics")

    Info "GPU Utilization:     $($script:GpuUtil)%"
    Info "Encoder Utilization: $($script:EncUtil)%"
    Info "Decoder Utilization: $($script:DecUtil)%"
    Info "VRAM: $($script:VramUsed) MiB / $($script:VramTotal) MiB"
    Info "Active encode sessions: $($script:EncSessions)  |  Avg FPS: $encFps  |  Latency: $encLat us"
    Info "GPU Clock: $($script:GpuClock) / $($script:GpuClockMax) MHz"

    if ($script:EncUtil -ge 90) {
        Err "Encoder near saturation ($($script:EncUtil)%) - jobs competing for NVENC"
        AddFinding "critical" "encoder" "NVENC at $($script:EncUtil)% - reduce concurrent sessions" ""
    } elseif ($script:EncUtil -ge 70) {
        Warn "Encoder utilization high ($($script:EncUtil)%) - adding jobs will degrade perf"
        AddFinding "warn" "encoder" "NVENC at $($script:EncUtil)% - consider queuing jobs sequentially" ""
    } elseif ($script:EncUtil -ge 1) {
        Ok "Encoder active at $($script:EncUtil)% - headroom available"
    } else {
        Ok "Encoder idle"
    }

    if ($script:EncSessions -ge 5) {
        Warn "$($script:EncSessions) active encoder sessions - consider reducing"
        AddFinding "warn" "encoder" "$($script:EncSessions) concurrent NVENC sessions - queue sequentially" ""
    }

    if ($script:VramTotal -gt 0) {
        $vramPct = [int]($script:VramUsed * 100 / $script:VramTotal)
        if ($vramPct -ge 90) {
            Err "VRAM nearly full ($vramPct%) - may cause failures"
            AddFinding "critical" "vram" "VRAM at $vramPct% - close unused GPU apps" ""
        } elseif ($vramPct -ge 75) {
            Warn "VRAM usage elevated ($vramPct%)"
            AddFinding "warn" "vram" "VRAM at $vramPct%" ""
        }
    }
}

function CheckGpuProcesses {
    Section "GPU Processes"

    $procs = NvSmi @("--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader")
    if (-not $procs) {
        Info "No compute processes using the GPU"
        return
    }

    foreach ($line in $procs) {
        if ($line.Trim()) {
            $parts = $line -split ","
            $pid   = $parts[0].Trim()
            $pname = Split-Path $parts[1].Trim() -Leaf
            $mem   = if ($parts.Count -ge 3) { $parts[2].Trim() } else { "N/A" }
            Info "PID ${pid}: $pname ($mem)"
        }
    }

    $procsStr = $procs | Out-String
    if ($procsStr -match "BlueIris|SecuritySpy") {
        Warn "Security camera software detected - competes for NVENC"
        AddFinding "warn" "process" "Security camera software using NVENC - consider CPU encoding for cameras" ""
    }
    if ($procsStr -match "obs|streamlabs") {
        Warn "Streaming software detected - shares NVENC"
        AddFinding "warn" "process" "Streaming software using NVENC - pause during batch encoding" ""
    }
}

function CheckFfmpeg {
    Section "FFmpeg Configuration"

    $searchPaths = @(
        "ffmpeg"
        "C:\ffmpeg\ffmpeg.exe"
        "$env:ProgramFiles\ffmpeg\bin\ffmpeg.exe"
        "$env:LOCALAPPDATA\ffmpeg\ffmpeg.exe"
    )
    foreach ($p in $searchPaths) {
        try {
            $result = & $p -version 2>&1 | Select-Object -First 1
            if ($result -match "ffmpeg version") {
                $script:FfmpegPath = $p
                $script:FfmpegVer  = ($result -split " ")[2]
                break
            }
        } catch {}
    }

    if (-not $script:FfmpegPath) {
        Err "FFmpeg not found"
        AddFinding "critical" "ffmpeg" "FFmpeg not installed - required for GPU encoding" ""
        return
    }

    Ok "FFmpeg $($script:FfmpegVer) at $($script:FfmpegPath)"

    $encoders = & $script:FfmpegPath -encoders 2>&1 | Out-String
    $script:HasNvenc    = $encoders -match "h264_nvenc|hevc_nvenc"
    $script:HasAv1Nvenc = $encoders -match "av1_nvenc"

    if ($script:HasNvenc)    { Ok "NVENC encoders available (h264, hevc)" }
    else { Err "No NVENC encoders - FFmpeg not built with NVENC"; AddFinding "critical" "ffmpeg" "FFmpeg lacks NVENC" "" }

    if ($script:HasAv1Nvenc) { Ok "AV1 hardware encoder available (best compression)" }
    else { Info "No AV1 NVENC - requires RTX 40-series+" }

    $decoders = & $script:FfmpegPath -decoders 2>&1 | Out-String
    $script:HasCuvid = $decoders -match "cuvid"

    if ($script:HasCuvid) { Ok "CUVID hardware decoders available" }
    else {
        Warn "No CUVID decoders - decoding will use CPU"
        AddFinding "warn" "ffmpeg" "FFmpeg lacks CUVID - reinstall with --enable-cuvid" ""
    }

    $hwaccels = & $script:FfmpegPath -hwaccels 2>&1 | Out-String
    if ($hwaccels -match "cuda") { Ok "CUDA hwaccel available" }
    else { Warn "CUDA hwaccel not available"; AddFinding "warn" "ffmpeg" "Missing CUDA hwaccel" "" }
}

function CheckPowerPlan {
    Section "System Power Configuration"

    $planOutput = powercfg /getactivescheme 2>$null
    $script:PowerPlan = if ($planOutput -match '\((.+)\)') { $Matches[1] } else { "Unknown" }
    Info "Active power plan: $Bold$($script:PowerPlan)$R"

    if ($script:PowerPlan -match "Balanced|Power saver|Energy") {
        Warn "Power plan '$($script:PowerPlan)' may throttle CPU during encoding"
        AddFinding "warn" "power_plan" "Power plan '$($script:PowerPlan)' can throttle performance" "fix_power_plan"

        $hpGuid = $null
        $plans = powercfg /list 2>$null
        foreach ($line in $plans) {
            if ($line -match "High Performance" -and $line -match "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})") {
                $hpGuid = $Matches[1]
                break
            }
        }
        if ($hpGuid) {
            AddFix "fix_power_plan" "Switch to High Performance power plan" "powercfg /setactive $hpGuid"
        } else {
            AddFix "fix_power_plan" "Create and activate High Performance power plan" `
                "powercfg /duplicatescheme 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c; powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
        }
    } else {
        Ok "Power plan is performance-oriented"
    }

    # CPU max state
    $procQuery = powercfg /query SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 2>$null | Out-String
    if ($procQuery -match "Current AC Power Setting Index:\s*(0x[0-9a-fA-F]+)") {
        $maxPct = [int]$Matches[1]
        if ($maxPct -lt 100) {
            Warn "CPU max state capped at $maxPct%"
            AddFinding "warn" "cpu" "CPU max processor state is $maxPct% - should be 100%" "fix_cpu_max"
            AddFix "fix_cpu_max" "Set CPU max state to 100%" `
                "powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100; powercfg /setactive SCHEME_CURRENT"
        }
    }
}

function CheckCpu {
    Section "CPU Info"

    $cpuName = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).Name
    $cpuCores = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).NumberOfLogicalProcessors
    if (-not $cpuName) { $cpuName = "Unknown" }
    Info "CPU: $cpuName"
    Info "Logical cores: $cpuCores"
}

# ─── FFmpeg Templates ────────────────────────────────────────────────────────
function ShowFfmpegTemplates {
    Section "Optimized FFmpeg Command Templates"
    if (-not $script:FfmpegPath -or $Json) { return }

    $hw  = "-hwaccel cuda -hwaccel_output_format cuda"
    $q   = "-preset p4 -tune hq -rc vbr"
    $ffp = $script:FfmpegPath

    Write-Host ""
    Write-Host "  ${Bold}HEVC (H.265) - Good quality/size balance:$R"
    Write-Host "  ${Dim}$ffp $hw -i INPUT.mkv \$R"
    Write-Host "  ${Dim}  -c:v hevc_nvenc $q -cq 23 -c:a copy OUTPUT.mkv$R"
    Write-Host ""
    if ($script:HasAv1Nvenc) {
        Write-Host "  ${Bold}AV1 - Best compression (RTX 40-series):$R"
        Write-Host "  ${Dim}$ffp $hw -i INPUT.mkv \$R"
        Write-Host "  ${Dim}  -c:v av1_nvenc $q -cq 28 -c:a copy OUTPUT.mkv$R"
        Write-Host ""
    }
    Write-Host "  ${Bold}H.264 - Maximum compatibility:$R"
    Write-Host "  ${Dim}$ffp $hw -i INPUT.mkv \$R"
    Write-Host "  ${Dim}  -c:v h264_nvenc $q -cq 20 -c:a copy OUTPUT.mkv$R"
    Write-Host ""
    Write-Host "  ${Bold}Run at low priority (background encoding):$R"
    Write-Host "  ${Dim}Start-Process -FilePath `"$ffp`" -ArgumentList `"$hw -i INPUT.mkv -c:v hevc_nvenc $q -cq 23 -c:a copy OUTPUT.mkv`" -WindowStyle Minimized -Priority BelowNormal$R"
    Write-Host ""
    Write-Host "  ${Dim}Key flags:$R"
    Write-Host "  ${Dim}  -hwaccel cuda          = decode on GPU (avoids CPU->GPU bottleneck)$R"
    Write-Host "  ${Dim}  -hwaccel_output_format  = keep frames in GPU memory$R"
    Write-Host "  ${Dim}  -preset p4             = quality/speed balance (p1=fastest, p7=best quality)$R"
    Write-Host "  ${Dim}  -tune hq               = enable lookahead and quality features$R"
    Write-Host "  ${Dim}  -rc vbr -cq N          = constant-quality VBR (lower N = higher quality)$R"
}

# ─── Summary & Fix Engine ────────────────────────────────────────────────────
function ShowSummary {
    Section "Summary"

    $ok   = ($script:Findings | Where-Object { $_.Sev -eq "ok" }).Count
    $warn = ($script:Findings | Where-Object { $_.Sev -eq "warn" }).Count
    $crit = ($script:Findings | Where-Object { $_.Sev -eq "critical" }).Count

    Write-Host ""
    if ($crit -gt 0) {
        Write-Host "  $Red${Bold}$crit critical issue(s)$R  $Yel${warn} warning(s)$R  $Grn${ok} passed$R"
    } elseif ($warn -gt 0) {
        Write-Host "  $Yel${Bold}$warn warning(s)$R  $Grn${ok} passed$R"
    } else {
        Write-Host "  $Grn${Bold}All $ok checks passed - system looks great!$R"
    }
    Write-Host ""

    foreach ($f in $script:Findings) {
        switch ($f.Sev) {
            "critical" { Write-Host "  ${Red}[XX]${R} [$($f.Cat)] $($f.Msg)" }
            "warn"     { Write-Host "  ${Yel}[!!]${R} [$($f.Cat)] $($f.Msg)" }
        }
    }
}

function PrintJsonReport {
    $report = @{
        version  = $Version
        platform = "windows-powershell"
        gpu = @{
            name       = $script:GpuName
            driver     = $script:DriverVer
            cuda       = $script:CudaVer
            temp_c     = $script:GpuTemp
            power_limit_w = $script:GpuPowerLimit
            utilization_pct = $script:GpuUtil
            encoder_pct     = $script:EncUtil
            encoder_sessions = $script:EncSessions
            vram_used_mib    = $script:VramUsed
            vram_total_mib   = $script:VramTotal
        }
        ffmpeg = @{
            path        = $script:FfmpegPath
            version     = $script:FfmpegVer
            has_nvenc    = $script:HasNvenc
            has_av1_nvenc = $script:HasAv1Nvenc
            has_cuvid    = $script:HasCuvid
        }
        findings = $script:Findings | ForEach-Object {
            @{ severity = $_.Sev; category = $_.Cat; message = $_.Msg; fixable = [bool]$_.FixId }
        }
    }
    $report | ConvertTo-Json -Depth 5
}

function OfferFixes {
    $fixableIds = $script:Findings | Where-Object { $_.FixId } |
        Select-Object -ExpandProperty FixId -Unique

    if (-not $fixableIds) {
        Write-Host ""
        Write-Host "  ${Grn}No automatic fixes needed - system is well-configured.$R"
        return
    }

    Section "Available Fixes"

    $fixMap = @()
    $i = 1
    foreach ($fid in $fixableIds) {
        $fix = $script:Fixes | Where-Object { $_.Id -eq $fid } | Select-Object -First 1
        if ($fix) {
            Write-Host "  $Bold[$i]$R $($fix.Desc)"
            Write-Host "      ${Dim}-> $($fix.Cmd)$R"
            $fixMap += $fix
            $i++
        }
    }

    Write-Host ""

    if ($Auto) {
        Write-Host "  ${Cyn}-Auto mode: applying all fixes...$R"
        foreach ($fix in $fixMap) { ApplyFix $fix }
        return
    }

    Write-Host "  Enter fix numbers to apply (e.g. ${Bold}1 3$R), ${Bold}all$R, or ${Bold}skip$R:"
    $choice = Read-Host "  >"

    switch -Regex ($choice) {
        "^(skip|s|)$" { Write-Host "  ${Dim}Skipped - no changes made.$R" }
        "^(all|a)$"   { foreach ($fix in $fixMap) { ApplyFix $fix } }
        default {
            foreach ($num in ($choice -split "\s+")) {
                $idx = [int]$num - 1
                if ($idx -ge 0 -and $idx -lt $fixMap.Count) {
                    ApplyFix $fixMap[$idx]
                } else {
                    Write-Host "  ${Yel}Invalid selection: $num$R"
                }
            }
        }
    }
}

function ApplyFix($fix) {
    Write-Host "  ${Cyn}Applying:$R $($fix.Desc)"
    Write-Host "  ${Dim}> $($fix.Cmd)$R"
    try {
        Invoke-Expression $fix.Cmd 2>&1 | ForEach-Object { Write-Host "    $_" }
        Write-Host "  ${Grn}[OK] Done$R"
    } catch {
        Write-Host "  ${Red}[XX] Failed - may require Administrator privileges$R"
        Write-Host "  ${Dim}  Try: Run PowerShell as Administrator$R"
    }
    Write-Host ""
}

# ─── Main ────────────────────────────────────────────────────────────────────
Banner
if (-not $Json) {
    Write-Host "  ${Dim}Platform: Windows (PowerShell)  |  Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm')$R"
}

$gpuFound = CheckGpu
if ($gpuFound) {
    CheckGpuHealth
    CheckEncoder
    CheckGpuProcesses
}
CheckFfmpeg
CheckCpu
CheckPowerPlan

if ($Json) {
    PrintJsonReport
    exit 0
}

ShowFfmpegTemplates
ShowSummary

if (-not $ReportOnly) {
    OfferFixes
}

Write-Host ""
Write-Host "${Dim}--- GPU Performance Doctor v${Version} - run with -Help for options ---$R"
Write-Host ""

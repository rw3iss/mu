#!/usr/bin/env bash
###############################################################################
# GPU Performance Doctor — Cross-platform NVIDIA encoding optimizer
# Works on: Linux, macOS, Windows (Git Bash / MSYS2 / WSL)
#
# Usage:  bash gpu-doctor.sh [--auto] [--report-only] [--json]
#   --auto         Apply safe fixes without prompting
#   --report-only  Print diagnostics only, no fix offers
#   --json         Output machine-readable JSON report
###############################################################################
set -euo pipefail

VERSION="1.0.0"

# ─── Options ─────────────────────────────────────────────────────────────────
AUTO_FIX=false
REPORT_ONLY=false
JSON_OUT=false
for arg in "$@"; do
  case "$arg" in
    --auto)        AUTO_FIX=true ;;
    --report-only) REPORT_ONLY=true ;;
    --json)        JSON_OUT=true ;;
    --help|-h)
      echo "GPU Performance Doctor v${VERSION}"
      echo "Usage: bash gpu-doctor.sh [--auto] [--report-only] [--json]"
      exit 0 ;;
  esac
done

# ─── Platform detection ──────────────────────────────────────────────────────
detect_platform() {
  case "$(uname -s)" in
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        PLATFORM="wsl"
      else
        PLATFORM="linux"
      fi ;;
    Darwin*)  PLATFORM="macos" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)        PLATFORM="unknown" ;;
  esac
}
detect_platform

# ─── Colors (disabled when piped or --json) ──────────────────────────────────
if [[ -t 1 ]] && ! $JSON_OUT; then
  RED='\033[0;31m'    GREEN='\033[0;32m'  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'   MAGENTA='\033[0;35m' CYAN='\033[0;36m'
  BOLD='\033[1m'      DIM='\033[2m'        RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' MAGENTA='' CYAN='' BOLD='' DIM='' RESET=''
fi

# ─── Output helpers ──────────────────────────────────────────────────────────
FINDINGS=()       # ("severity|category|message|fix_id")
FIX_COMMANDS=()   # ("fix_id|description|command")

banner() {
  $JSON_OUT && return
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${CYAN}║          GPU Performance Doctor  v${VERSION}                    ║${RESET}"
  echo -e "${BOLD}${CYAN}║          Encoding Optimization Analyzer                      ║${RESET}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

section() {
  $JSON_OUT && return
  echo ""
  echo -e "${BOLD}${BLUE}━━━ $1 ━━━${RESET}"
}

status_ok()   { $JSON_OUT && return; printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
status_warn() { $JSON_OUT && return; printf "  ${YELLOW}⚠${RESET} %s\n" "$1"; }
status_err()  { $JSON_OUT && return; printf "  ${RED}✗${RESET} %s\n" "$1"; }
status_info() { $JSON_OUT && return; printf "  ${DIM}·${RESET} %s\n" "$1"; }

add_finding() {
  # severity: ok|warn|critical   category   message   fix_id (empty if no fix)
  FINDINGS+=("$1|$2|$3|${4:-}")
}

add_fix() {
  # fix_id  description  command
  FIX_COMMANDS+=("$1|$2|$3")
}

cmd_exists() { command -v "$1" &>/dev/null; }

# Safe numeric comparison — returns 0 if $1 >= $2 (integers)
num_gte() { [[ "$1" -ge "$2" ]] 2>/dev/null; }

# ─── nvidia-smi wrapper ─────────────────────────────────────────────────────
NVIDIA_SMI=""
find_nvidia_smi() {
  if cmd_exists nvidia-smi; then
    NVIDIA_SMI="nvidia-smi"
  elif [[ -f "/c/Windows/System32/nvidia-smi.exe" ]]; then
    NVIDIA_SMI="/c/Windows/System32/nvidia-smi.exe"
  elif [[ -f "/c/Program Files/NVIDIA Corporation/NVSMI/nvidia-smi.exe" ]]; then
    NVIDIA_SMI="/c/Program Files/NVIDIA Corporation/NVSMI/nvidia-smi.exe"
  elif [[ -f "/usr/lib/wsl/lib/nvidia-smi" ]]; then
    NVIDIA_SMI="/usr/lib/wsl/lib/nvidia-smi"
  fi
}

nvsmi() { "$NVIDIA_SMI" "$@" 2>/dev/null; }

nvsmi_query() {
  # Query a single CSV field, e.g. nvsmi_query "temperature.gpu"
  nvsmi --query-gpu="$1" --format=csv,noheader,nounits 2>/dev/null | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

nvsmi_query_nospace() {
  # Same but strips ALL spaces (for numeric values)
  nvsmi --query-gpu="$1" --format=csv,noheader,nounits 2>/dev/null | tr -d ' \r'
}

# ─── Globals populated by checks ────────────────────────────────────────────
GPU_NAME="" DRIVER_VER="" CUDA_VER=""
GPU_TEMP="" GPU_FAN="" GPU_POWER="" GPU_POWER_LIMIT="" GPU_POWER_MAX=""
GPU_UTIL="" ENC_UTIL="" DEC_UTIL="" ENC_SESSIONS=""
GPU_CLOCK="" GPU_CLOCK_MAX="" MEM_CLOCK="" MEM_CLOCK_MAX=""
GPU_VRAM_USED="" GPU_VRAM_TOTAL="" PERF_STATE=""
THROTTLE_THERMAL="" THROTTLE_POWER="" THROTTLE_HW=""
FFMPEG_PATH="" FFMPEG_VER="" HAS_NVENC="" HAS_CUVID="" HAS_AV1_NVENC=""
CPU_NAME="" CPU_CORES=""
POWER_PLAN=""

###############################################################################
#                           CHECK FUNCTIONS                                    #
###############################################################################

check_gpu_present() {
  section "GPU Detection"

  find_nvidia_smi
  if [[ -z "$NVIDIA_SMI" ]]; then
    status_err "nvidia-smi not found — no NVIDIA GPU detected or drivers not installed"
    add_finding "critical" "gpu" "NVIDIA GPU not detected or drivers not installed" ""

    # Check for AMD/Intel
    case "$PLATFORM" in
      linux)
        if lspci 2>/dev/null | grep -qi "vga.*amd\|vga.*radeon"; then
          status_info "AMD GPU detected — this tool currently focuses on NVIDIA NVENC"
        elif lspci 2>/dev/null | grep -qi "vga.*intel"; then
          status_info "Intel GPU detected — consider Intel Quick Sync for encoding"
        fi ;;
      macos)
        local gpu_info
        gpu_info=$(system_profiler SPDisplaysDataType 2>/dev/null | grep "Chipset Model" | head -1 || true)
        if [[ -n "$gpu_info" ]]; then
          status_info "GPU: ${gpu_info##*: }"
          status_info "macOS uses VideoToolbox for hardware encoding (no NVIDIA support)"
          add_finding "warn" "gpu" "macOS detected — use VideoToolbox (-c:v h264_videotoolbox) instead of NVENC" ""
        fi ;;
    esac
    return 1
  fi

  GPU_NAME=$(nvsmi_query "gpu_name")
  DRIVER_VER=$(nvsmi_query_nospace "driver_version")
  CUDA_VER=$(nvsmi 2>/dev/null | grep "CUDA Version" | sed 's/.*CUDA Version: *//;s/ .*//' || echo "N/A")

  status_ok "GPU: ${BOLD}${GPU_NAME}${RESET}"
  status_ok "Driver: ${DRIVER_VER}  |  CUDA: ${CUDA_VER}"
  add_finding "ok" "gpu" "NVIDIA GPU detected: ${GPU_NAME} (driver ${DRIVER_VER})" ""
  return 0
}

check_gpu_health() {
  section "GPU Health & Thermals"

  GPU_TEMP=$(nvsmi_query_nospace "temperature.gpu")
  GPU_FAN=$(nvsmi_query_nospace "fan.speed")
  GPU_POWER=$(nvsmi_query "power.draw" 2>/dev/null || echo "N/A")
  GPU_POWER_LIMIT=$(nvsmi_query "power.limit")
  GPU_POWER_MAX=$(nvsmi_query "power.max_limit")
  PERF_STATE=$(nvsmi_query_nospace "pstate")

  status_info "Temperature: ${GPU_TEMP}°C  |  Fan: ${GPU_FAN}%  |  PState: ${PERF_STATE}"
  status_info "Power: ${GPU_POWER}W / ${GPU_POWER_LIMIT}W limit (max ${GPU_POWER_MAX}W)"

  # Temperature analysis
  if num_gte "${GPU_TEMP}" 85 2>/dev/null; then
    status_err "GPU temperature is critically high (${GPU_TEMP}°C) — thermal throttling likely"
    add_finding "critical" "thermal" "GPU at ${GPU_TEMP}°C — improve cooling or reduce workload" "fix_fan"
  elif num_gte "${GPU_TEMP}" 75 2>/dev/null; then
    status_warn "GPU temperature is elevated (${GPU_TEMP}°C) — monitor closely"
    add_finding "warn" "thermal" "GPU at ${GPU_TEMP}°C — consider improving airflow" ""
  else
    status_ok "Temperature is healthy (${GPU_TEMP}°C)"
  fi

  # Power headroom
  if [[ "$GPU_POWER_LIMIT" != "N/A" && "$GPU_POWER_MAX" != "N/A" ]]; then
    local limit_int=${GPU_POWER_LIMIT%%.*}
    local max_int=${GPU_POWER_MAX%%.*}
    if [[ "$limit_int" -lt "$max_int" ]] 2>/dev/null; then
      status_warn "Power limit (${GPU_POWER_LIMIT}W) is below max (${GPU_POWER_MAX}W)"
      add_finding "warn" "power" "GPU power limit ${GPU_POWER_LIMIT}W < max ${GPU_POWER_MAX}W — raising may improve perf" "fix_power_limit"
      add_fix "fix_power_limit" "Raise GPU power limit to ${GPU_POWER_MAX}W" \
        "\"$NVIDIA_SMI\" -pl ${GPU_POWER_MAX}"
    else
      status_ok "Power limit at maximum (${GPU_POWER_LIMIT}W)"
    fi
  fi

  # Throttle detection — must distinguish "Active" from "Not Active"
  local perf_data
  perf_data=$(nvsmi -q -d PERFORMANCE 2>/dev/null || true)
  THROTTLE_THERMAL=$(echo "$perf_data" | grep "HW Thermal Slowdown" | head -1 | grep -o ': .*' | sed 's/: //')
  THROTTLE_POWER=$(echo "$perf_data" | grep "SW Power Cap" | head -1 | grep -o ': .*' | sed 's/: //')
  THROTTLE_HW=$(echo "$perf_data" | grep "HW Slowdown" | head -1 | grep -o ': .*' | sed 's/: //')

  if [[ "$THROTTLE_THERMAL" == "Active" ]]; then
    status_err "THERMAL THROTTLING ACTIVE — GPU is overheating"
    add_finding "critical" "thermal" "Thermal throttling active — GPU is overheating" ""
  fi
  if [[ "$THROTTLE_POWER" == "Active" ]]; then
    status_warn "Software power capping active"
    add_finding "warn" "power" "SW power cap is throttling the GPU" "fix_power_limit"
  fi
  if [[ "$THROTTLE_HW" == "Active" ]]; then
    status_err "Hardware slowdown active"
    add_finding "critical" "throttle" "Hardware slowdown active — check power supply and cooling" ""
  fi
  if [[ "$THROTTLE_THERMAL" != "Active" && "$THROTTLE_POWER" != "Active" && "$THROTTLE_HW" != "Active" ]]; then
    status_ok "No throttling detected"
  fi
}

check_encoder() {
  section "NVENC Encoder Status"

  GPU_UTIL=$(nvsmi_query_nospace "utilization.gpu")
  ENC_UTIL=$(nvsmi_query_nospace "utilization.encoder")
  DEC_UTIL=$(nvsmi_query_nospace "utilization.decoder")
  GPU_VRAM_USED=$(nvsmi_query_nospace "memory.used")
  GPU_VRAM_TOTAL=$(nvsmi_query_nospace "memory.total")

  # Encoder sessions
  local enc_stats
  enc_stats=$(nvsmi -q -d ENCODER_STATS 2>/dev/null || true)
  ENC_SESSIONS=$(echo "$enc_stats" | grep "Active Sessions" | awk '{print $NF}')
  local enc_fps
  enc_fps=$(echo "$enc_stats" | grep "Average FPS" | awk '{print $NF}')
  local enc_latency
  enc_latency=$(echo "$enc_stats" | grep "Average Latency" | awk '{print $NF}')

  status_info "GPU Utilization:     ${GPU_UTIL}%"
  status_info "Encoder Utilization: ${ENC_UTIL}%"
  status_info "Decoder Utilization: ${DEC_UTIL}%"
  status_info "VRAM: ${GPU_VRAM_USED} MiB / ${GPU_VRAM_TOTAL} MiB"
  status_info "Active encode sessions: ${ENC_SESSIONS:-0}  |  Avg FPS: ${enc_fps:-N/A}  |  Latency: ${enc_latency:-N/A} µs"

  # Clock speeds
  GPU_CLOCK=$(nvsmi_query_nospace "clocks.current.graphics")
  GPU_CLOCK_MAX=$(nvsmi_query_nospace "clocks.max.graphics")
  MEM_CLOCK=$(nvsmi_query_nospace "clocks.current.memory")
  MEM_CLOCK_MAX=$(nvsmi_query_nospace "clocks.max.memory")
  status_info "Clocks: GPU ${GPU_CLOCK}/${GPU_CLOCK_MAX} MHz  |  Mem ${MEM_CLOCK}/${MEM_CLOCK_MAX} MHz"

  # Encoder utilization analysis
  local enc_int=${ENC_UTIL%%%}
  if num_gte "$enc_int" 90 2>/dev/null; then
    status_err "Encoder is near saturation (${ENC_UTIL}%) — jobs are competing for NVENC"
    add_finding "critical" "encoder" "NVENC at ${ENC_UTIL}% — reduce concurrent encode sessions for better throughput" ""
  elif num_gte "$enc_int" 70 2>/dev/null; then
    status_warn "Encoder utilization is high (${ENC_UTIL}%) — adding more jobs will degrade perf"
    add_finding "warn" "encoder" "NVENC at ${ENC_UTIL}% — near capacity, consider queuing jobs sequentially" ""
  elif num_gte "$enc_int" 1 2>/dev/null; then
    status_ok "Encoder active at ${ENC_UTIL}% — headroom available"
  else
    status_ok "Encoder idle"
  fi

  # NVENC session limit info
  local sessions_int=${ENC_SESSIONS:-0}
  if num_gte "$sessions_int" 5 2>/dev/null; then
    status_warn "${ENC_SESSIONS} active encoder sessions — consider reducing for better per-job throughput"
    add_finding "warn" "encoder" "${ENC_SESSIONS} concurrent NVENC sessions — queue jobs sequentially for best per-job speed" ""
  fi

  # VRAM pressure
  if [[ -n "$GPU_VRAM_USED" && -n "$GPU_VRAM_TOTAL" ]]; then
    local vram_pct=$(( GPU_VRAM_USED * 100 / GPU_VRAM_TOTAL ))
    if num_gte "$vram_pct" 90; then
      status_err "VRAM nearly full (${vram_pct}%) — may cause failures or slowdowns"
      add_finding "critical" "vram" "VRAM at ${vram_pct}% — close unused GPU applications" ""
    elif num_gte "$vram_pct" 75; then
      status_warn "VRAM usage elevated (${vram_pct}%)"
      add_finding "warn" "vram" "VRAM at ${vram_pct}% — monitor for pressure" ""
    fi
  fi
}

check_gpu_processes() {
  section "GPU Processes"

  local procs
  procs=$(nvsmi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null | tr -d '\r' || true)

  if [[ -z "$procs" ]]; then
    status_info "No compute processes using the GPU"
    return
  fi

  while IFS=, read -r pid pname mem; do
    pid=$(echo "$pid" | sed 's/^[[:space:]]*//')
    pname=$(echo "$pname" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    mem=$(echo "$mem" | tr -d ' ')
    status_info "PID ${pid}: ${pname} (${mem})"
  done <<< "$procs"

  # Detect known resource-heavy background apps
  if echo "$procs" | grep -qi "BlueIris\|SecuritySpy\|shinobi\|zoneminder"; then
    status_warn "Security camera software detected — competes with encoding for NVENC"
    add_finding "warn" "process" "Security camera software is using NVENC — consider CPU encoding for cameras to free GPU for movie encoding" ""
  fi
  if echo "$procs" | grep -qi "obs\|streamlabs"; then
    status_warn "Streaming software detected — shares NVENC with encoding jobs"
    add_finding "warn" "process" "Streaming software is using NVENC — pause streaming during batch encoding" ""
  fi
}

check_ffmpeg() {
  section "FFmpeg Configuration"

  FFMPEG_PATH=$(command -v ffmpeg 2>/dev/null || true)
  if [[ -z "$FFMPEG_PATH" ]]; then
    # Windows: check common locations
    for p in "/c/ffmpeg/ffmpeg.exe" "/c/Program Files/ffmpeg/bin/ffmpeg.exe" \
             "/usr/local/bin/ffmpeg" "/opt/homebrew/bin/ffmpeg"; do
      if [[ -f "$p" ]]; then
        FFMPEG_PATH="$p"
        break
      fi
    done
  fi

  if [[ -z "$FFMPEG_PATH" ]]; then
    status_err "FFmpeg not found"
    add_finding "critical" "ffmpeg" "FFmpeg not installed — required for GPU-accelerated encoding" "fix_ffmpeg_install"
    return
  fi

  FFMPEG_VER=$("$FFMPEG_PATH" -version 2>&1 | head -1 | awk '{print $3}')
  status_ok "FFmpeg ${FFMPEG_VER} at ${FFMPEG_PATH}"

  # Check NVENC encoders
  local encoders
  encoders=$("$FFMPEG_PATH" -encoders 2>&1 || true)
  HAS_NVENC=$(echo "$encoders" | grep -c "h264_nvenc\|hevc_nvenc" || true)
  HAS_AV1_NVENC=$(echo "$encoders" | grep -c "av1_nvenc" || true)

  if [[ "$HAS_NVENC" -gt 0 ]]; then
    status_ok "NVENC encoders: h264_nvenc, hevc_nvenc"
  else
    status_err "No NVENC encoders found — FFmpeg may not be built with NVENC support"
    add_finding "critical" "ffmpeg" "FFmpeg lacks NVENC support — reinstall with --enable-nvenc" ""
  fi

  if [[ "$HAS_AV1_NVENC" -gt 0 ]]; then
    status_ok "AV1 hardware encoder available (av1_nvenc) — best compression"
  else
    status_info "No AV1 NVENC — GPU may not support it (RTX 40-series+ required)"
  fi

  # Check CUVID decoders
  local decoders
  decoders=$("$FFMPEG_PATH" -decoders 2>&1 || true)
  HAS_CUVID=$(echo "$decoders" | grep -c "cuvid" || true)

  if [[ "$HAS_CUVID" -gt 0 ]]; then
    status_ok "CUVID hardware decoders available"
  else
    status_warn "No CUVID decoders — decoding will use CPU (slower, adds PCIe transfer overhead)"
    add_finding "warn" "ffmpeg" "FFmpeg lacks CUVID decoders — reinstall with --enable-cuvid for GPU decode" ""
  fi

  # Check for hwaccel support
  local hwaccels
  hwaccels=$("$FFMPEG_PATH" -hwaccels 2>&1 || true)
  if echo "$hwaccels" | grep -q "cuda"; then
    status_ok "CUDA hwaccel available"
  else
    status_warn "CUDA hwaccel not listed"
    add_finding "warn" "ffmpeg" "FFmpeg missing CUDA hwaccel — rebuild with --enable-cuda-llvm" ""
  fi

  # macOS-specific: check VideoToolbox
  if [[ "$PLATFORM" == "macos" ]]; then
    if echo "$encoders" | grep -q "videotoolbox"; then
      status_ok "VideoToolbox encoders available (Apple hardware encoding)"
    else
      status_warn "VideoToolbox not available"
    fi
  fi
}

check_power_plan() {
  section "System Power Configuration"

  case "$PLATFORM" in
    windows|wsl)
      POWER_PLAN=$(MSYS_NO_PATHCONV=1 powercfg /getactivescheme 2>/dev/null | sed -n 's/.*(\(.*\))/\1/p' || echo "Unknown")
      POWER_PLAN=$(echo "$POWER_PLAN" | tr -d '\r')
      [[ -z "$POWER_PLAN" ]] && POWER_PLAN="Unknown"
      status_info "Active power plan: ${BOLD}${POWER_PLAN}${RESET}"

      if echo "$POWER_PLAN" | grep -qi "balanced\|power saver\|energy"; then
        status_warn "Power plan '${POWER_PLAN}' may throttle CPU during encoding"
        add_finding "warn" "power_plan" "Power plan '${POWER_PLAN}' can throttle performance — switch to High Performance" "fix_power_plan"

        # Find the High Performance GUID
        local hp_guid
        hp_guid=$(MSYS_NO_PATHCONV=1 powercfg /list 2>/dev/null | grep -i "high performance" | sed -n 's/.*\([0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}\).*/\1/p' || true)
        if [[ -n "$hp_guid" ]]; then
          add_fix "fix_power_plan" "Switch to High Performance power plan" \
            "MSYS_NO_PATHCONV=1 powercfg /setactive ${hp_guid}"
        else
          # Create the scheme if missing (Windows 11 hides it)
          add_fix "fix_power_plan" "Create and activate High Performance power plan" \
            "MSYS_NO_PATHCONV=1 powercfg /duplicatescheme 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c && MSYS_NO_PATHCONV=1 powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
        fi
      else
        status_ok "Power plan is performance-oriented"
      fi

      # Check processor max state
      local proc_max
      proc_max=$(MSYS_NO_PATHCONV=1 powercfg /query SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 2>/dev/null \
        | grep "Current AC Power" | awk '{print $NF}')
      if [[ -n "$proc_max" ]]; then
        local pmax_dec=$((proc_max))
        if [[ "$pmax_dec" -lt 100 ]]; then
          status_warn "CPU max state capped at ${pmax_dec}%"
          add_finding "warn" "cpu" "CPU max processor state is ${pmax_dec}% — should be 100% for encoding" "fix_cpu_max"
          add_fix "fix_cpu_max" "Set CPU max processor state to 100%" \
            "MSYS_NO_PATHCONV=1 powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100 && MSYS_NO_PATHCONV=1 powercfg /setactive SCHEME_CURRENT"
        fi
      fi
      ;;

    macos)
      if cmd_exists pmset; then
        local pm
        pm=$(pmset -g 2>/dev/null || true)
        status_info "Power settings:"

        local lowpower
        lowpower=$(echo "$pm" | grep "lowpowermode" | awk '{print $2}')
        if [[ "$lowpower" == "1" ]]; then
          status_warn "Low Power Mode is ON — will reduce encoding performance"
          add_finding "warn" "power_plan" "Low Power Mode is ON — disable for encoding" "fix_macos_power"
          add_fix "fix_macos_power" "Disable Low Power Mode" \
            "sudo pmset -a lowpowermode 0"
        else
          status_ok "Low Power Mode is off"
        fi

        # Check if autopoweroff or standby could interrupt long encodes
        local autopoweroff
        autopoweroff=$(echo "$pm" | grep "autopoweroff " | awk '{print $2}')
        if [[ "$autopoweroff" == "1" ]]; then
          status_warn "Auto power off is enabled — may interrupt long encodes"
          add_finding "warn" "power_plan" "Auto power off could interrupt long encoding jobs" "fix_macos_autopoweroff"
          add_fix "fix_macos_autopoweroff" "Disable auto power off during encoding sessions" \
            "sudo pmset -a autopoweroff 0"
        fi
      fi
      ;;

    linux)
      if [[ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]]; then
        local governor
        governor=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo "unknown")
        status_info "CPU governor: ${governor}"

        if [[ "$governor" != "performance" ]]; then
          status_warn "CPU governor is '${governor}' — 'performance' is optimal for encoding"
          add_finding "warn" "power_plan" "CPU governor is '${governor}' — switch to 'performance'" "fix_linux_governor"
          add_fix "fix_linux_governor" "Set CPU governor to performance" \
            "echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor"
        else
          status_ok "CPU governor set to performance"
        fi
      fi

      # GPU persistence mode
      local persist
      persist=$(nvsmi_query "persistence_mode" 2>/dev/null || echo "Disabled")
      if [[ "$persist" != "Enabled" ]]; then
        status_warn "GPU persistence mode is off — causes startup latency for each encode"
        add_finding "warn" "gpu" "GPU persistence mode disabled — enable for faster job startup" "fix_persist"
        add_fix "fix_persist" "Enable GPU persistence mode" \
          "sudo nvidia-smi -pm 1"
      else
        status_ok "GPU persistence mode enabled"
      fi
      ;;
  esac
}

check_cpu() {
  section "CPU Info"

  case "$PLATFORM" in
    linux|wsl)
      CPU_NAME=$(grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs)
      CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo "?")
      ;;
    macos)
      CPU_NAME=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Unknown")
      CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "?")
      ;;
    windows)
      CPU_NAME=$(grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo "Unknown")
      CPU_CORES=$(nproc 2>/dev/null || echo "?")
      ;;
  esac

  status_info "CPU: ${CPU_NAME}"
  status_info "Logical cores: ${CPU_CORES}"
}

check_driver_age() {
  # We can't easily check driver release dates cross-platform, but we can
  # flag very old major versions.
  if [[ -z "$DRIVER_VER" ]]; then return; fi

  section "Driver Version"

  local major=${DRIVER_VER%%.*}
  case "$PLATFORM" in
    windows)
      # Windows drivers: 5xx is current (2024-2026), 4xx is old
      if num_gte 400 "$major" 2>/dev/null; then
        status_warn "Driver ${DRIVER_VER} may be outdated — check for updates at nvidia.com/drivers"
        add_finding "warn" "driver" "Driver ${DRIVER_VER} may be outdated" ""
      else
        status_ok "Driver ${DRIVER_VER} appears current"
      fi ;;
    linux)
      if num_gte 470 "$major" 2>/dev/null; then
        status_warn "Driver ${DRIVER_VER} may be outdated"
        add_finding "warn" "driver" "Driver ${DRIVER_VER} may be outdated — update via package manager" ""
      else
        status_ok "Driver ${DRIVER_VER} appears current"
      fi ;;
  esac
}

###############################################################################
#                         OPTIMIZED COMMAND GENERATOR                          #
###############################################################################

generate_ffmpeg_templates() {
  section "Optimized FFmpeg Command Templates"

  if [[ -z "$FFMPEG_PATH" ]]; then
    status_info "FFmpeg not found — skipping command templates"
    return
  fi

  $JSON_OUT && return

  local hwaccel_flags="-hwaccel cuda -hwaccel_output_format cuda"
  local quality_flags="-preset p4 -tune hq -rc vbr"

  echo ""
  echo -e "  ${BOLD}HEVC (H.265) — Good quality/size balance:${RESET}"
  echo -e "  ${DIM}$FFMPEG_PATH ${hwaccel_flags} -i INPUT.mkv \\${RESET}"
  echo -e "  ${DIM}  -c:v hevc_nvenc ${quality_flags} -cq 23 -c:a copy OUTPUT.mkv${RESET}"
  echo ""
  if [[ "${HAS_AV1_NVENC:-0}" -gt 0 ]]; then
    echo -e "  ${BOLD}AV1 — Best compression (RTX 40-series):${RESET}"
    echo -e "  ${DIM}$FFMPEG_PATH ${hwaccel_flags} -i INPUT.mkv \\${RESET}"
    echo -e "  ${DIM}  -c:v av1_nvenc ${quality_flags} -cq 28 -c:a copy OUTPUT.mkv${RESET}"
    echo ""
  fi
  echo -e "  ${BOLD}H.264 — Maximum compatibility:${RESET}"
  echo -e "  ${DIM}$FFMPEG_PATH ${hwaccel_flags} -i INPUT.mkv \\${RESET}"
  echo -e "  ${DIM}  -c:v h264_nvenc ${quality_flags} -cq 20 -c:a copy OUTPUT.mkv${RESET}"
  echo ""
  echo -e "  ${BOLD}Batch encode (sequential for best throughput):${RESET}"
  echo -e "  ${DIM}for f in *.mkv; do${RESET}"
  echo -e "  ${DIM}  $FFMPEG_PATH ${hwaccel_flags} -i \"\$f\" \\${RESET}"
  echo -e "  ${DIM}    -c:v hevc_nvenc ${quality_flags} -cq 23 -c:a copy \"encoded/\${f%.*}.mkv\"${RESET}"
  echo -e "  ${DIM}done${RESET}"
  echo ""

  if [[ "$PLATFORM" == "windows" ]]; then
    echo -e "  ${BOLD}Run at low priority (won't interfere with other tasks):${RESET}"
    echo -e "  ${DIM}cmd //c \"start /belownormal /wait $FFMPEG_PATH ${hwaccel_flags} -i INPUT.mkv \\${RESET}"
    echo -e "  ${DIM}  -c:v hevc_nvenc ${quality_flags} -cq 23 -c:a copy OUTPUT.mkv\"${RESET}"
  elif [[ "$PLATFORM" == "linux" || "$PLATFORM" == "macos" ]]; then
    echo -e "  ${BOLD}Run at low priority (won't interfere with other tasks):${RESET}"
    echo -e "  ${DIM}nice -n 10 $FFMPEG_PATH ${hwaccel_flags} -i INPUT.mkv \\${RESET}"
    echo -e "  ${DIM}  -c:v hevc_nvenc ${quality_flags} -cq 23 -c:a copy OUTPUT.mkv${RESET}"
  fi
  echo ""
  echo -e "  ${DIM}Key flags explained:${RESET}"
  echo -e "  ${DIM}  -hwaccel cuda          = decode on GPU (avoids CPU→GPU bottleneck)${RESET}"
  echo -e "  ${DIM}  -hwaccel_output_format  = keep frames in GPU memory${RESET}"
  echo -e "  ${DIM}  -preset p4             = quality/speed balance (p1=fastest, p7=best quality)${RESET}"
  echo -e "  ${DIM}  -tune hq               = enable lookahead and quality features${RESET}"
  echo -e "  ${DIM}  -rc vbr -cq N          = constant-quality variable bitrate (lower N = higher quality)${RESET}"
}

###############################################################################
#                            REPORT & FIX ENGINE                               #
###############################################################################

print_summary() {
  section "Summary"

  local ok=0 warn=0 crit=0
  for f in "${FINDINGS[@]}"; do
    case "${f%%|*}" in
      ok)       ok=$((ok + 1)) ;;
      warn)     warn=$((warn + 1)) ;;
      critical) crit=$((crit + 1)) ;;
    esac
  done

  echo ""
  if [[ "$crit" -gt 0 ]]; then
    echo -e "  ${RED}${BOLD}${crit} critical issue(s)${RESET}  ${YELLOW}${warn} warning(s)${RESET}  ${GREEN}${ok} passed${RESET}"
  elif [[ "$warn" -gt 0 ]]; then
    echo -e "  ${YELLOW}${BOLD}${warn} warning(s)${RESET}  ${GREEN}${ok} passed${RESET}"
  else
    echo -e "  ${GREEN}${BOLD}All ${ok} checks passed — system looks great!${RESET}"
  fi
  echo ""

  # List issues
  for f in "${FINDINGS[@]}"; do
    IFS='|' read -r sev cat msg fix_id <<< "$f"
    case "$sev" in
      critical) echo -e "  ${RED}✗${RESET} [${cat}] ${msg}" ;;
      warn)     echo -e "  ${YELLOW}⚠${RESET} [${cat}] ${msg}" ;;
    esac
  done
}

print_json_report() {
  echo "{"
  echo "  \"version\": \"${VERSION}\","
  echo "  \"platform\": \"${PLATFORM}\","
  echo "  \"gpu\": {"
  echo "    \"name\": \"${GPU_NAME}\","
  echo "    \"driver\": \"${DRIVER_VER}\","
  echo "    \"cuda\": \"${CUDA_VER}\","
  echo "    \"temp_c\": ${GPU_TEMP:-null},"
  echo "    \"power_w\": \"${GPU_POWER}\","
  echo "    \"power_limit_w\": \"${GPU_POWER_LIMIT}\","
  echo "    \"utilization_pct\": ${GPU_UTIL:-null},"
  echo "    \"encoder_pct\": ${ENC_UTIL:-null},"
  echo "    \"decoder_pct\": ${DEC_UTIL:-null},"
  echo "    \"encoder_sessions\": ${ENC_SESSIONS:-null},"
  echo "    \"vram_used_mib\": ${GPU_VRAM_USED:-null},"
  echo "    \"vram_total_mib\": ${GPU_VRAM_TOTAL:-null},"
  echo "    \"clock_mhz\": ${GPU_CLOCK:-null},"
  echo "    \"clock_max_mhz\": ${GPU_CLOCK_MAX:-null}"
  echo "  },"
  echo "  \"ffmpeg\": {"
  echo "    \"path\": \"${FFMPEG_PATH}\","
  echo "    \"version\": \"${FFMPEG_VER}\","
  echo "    \"has_nvenc\": $( [[ "${HAS_NVENC:-0}" -gt 0 ]] && echo true || echo false ),"
  echo "    \"has_av1_nvenc\": $( [[ "${HAS_AV1_NVENC:-0}" -gt 0 ]] && echo true || echo false ),"
  echo "    \"has_cuvid\": $( [[ "${HAS_CUVID:-0}" -gt 0 ]] && echo true || echo false )"
  echo "  },"
  echo "  \"findings\": ["
  local first=true
  for f in "${FINDINGS[@]}"; do
    IFS='|' read -r sev cat msg fix_id <<< "$f"
    $first || echo ","
    first=false
    printf '    {"severity":"%s","category":"%s","message":"%s","fixable":%s}' \
      "$sev" "$cat" "$msg" "$( [[ -n "$fix_id" ]] && echo true || echo false )"
  done
  echo ""
  echo "  ]"
  echo "}"
}

offer_fixes() {
  # Collect fixable findings
  local fixable_ids=()
  for f in "${FINDINGS[@]}"; do
    IFS='|' read -r sev cat msg fix_id <<< "$f"
    if [[ -n "$fix_id" ]]; then
      # Deduplicate
      local already=false
      for eid in "${fixable_ids[@]+"${fixable_ids[@]}"}"; do
        [[ "$eid" == "$fix_id" ]] && already=true
      done
      $already || fixable_ids+=("$fix_id")
    fi
  done

  if [[ ${#fixable_ids[@]} -eq 0 ]]; then
    echo ""
    echo -e "  ${GREEN}No automatic fixes needed — your system is well-configured.${RESET}"
    return
  fi

  section "Available Fixes"

  local fix_index=1
  local fix_map=()  # parallel array

  for fid in "${fixable_ids[@]}"; do
    for fc in "${FIX_COMMANDS[@]}"; do
      IFS='|' read -r fc_id fc_desc fc_cmd <<< "$fc"
      if [[ "$fc_id" == "$fid" ]]; then
        echo -e "  ${BOLD}[${fix_index}]${RESET} ${fc_desc}"
        echo -e "      ${DIM}→ ${fc_cmd}${RESET}"
        fix_map+=("$fc_id")
        ((fix_index++))
        break
      fi
    done
  done

  echo ""

  if $AUTO_FIX; then
    echo -e "  ${CYAN}--auto mode: applying all fixes...${RESET}"
    for fid in "${fixable_ids[@]}"; do
      apply_fix "$fid"
    done
    return
  fi

  # Interactive prompt
  echo -e "  Enter fix numbers to apply (e.g. ${BOLD}1 3${RESET}), ${BOLD}all${RESET}, or ${BOLD}skip${RESET}:"
  read -r -p "  > " choice

  case "$choice" in
    skip|s|"") echo -e "  ${DIM}Skipped — no changes made.${RESET}" ;;
    all|a)
      for fid in "${fixable_ids[@]}"; do
        apply_fix "$fid"
      done ;;
    *)
      for num in $choice; do
        local idx=$((num - 1))
        if [[ $idx -ge 0 && $idx -lt ${#fix_map[@]} ]]; then
          apply_fix "${fix_map[$idx]}"
        else
          echo -e "  ${YELLOW}Invalid selection: ${num}${RESET}"
        fi
      done ;;
  esac
}

apply_fix() {
  local target_id="$1"
  for fc in "${FIX_COMMANDS[@]}"; do
    IFS='|' read -r fc_id fc_desc fc_cmd <<< "$fc"
    if [[ "$fc_id" == "$target_id" ]]; then
      echo -e "  ${CYAN}Applying:${RESET} ${fc_desc}"
      echo -e "  ${DIM}$ ${fc_cmd}${RESET}"
      if eval "$fc_cmd" 2>&1 | sed 's/^/    /'; then
        echo -e "  ${GREEN}✓ Done${RESET}"
      else
        echo -e "  ${RED}✗ Failed — may require admin/sudo privileges${RESET}"
        if [[ "$PLATFORM" == "windows" ]]; then
          echo -e "  ${DIM}  Try running from an Administrator terminal${RESET}"
        else
          echo -e "  ${DIM}  Try: sudo $fc_cmd${RESET}"
        fi
      fi
      echo ""
      return
    fi
  done
}

###############################################################################
#                                  MAIN                                        #
###############################################################################

main() {
  banner

  echo -e "  ${DIM}Platform: ${PLATFORM}  |  Date: $(date '+%Y-%m-%d %H:%M')${RESET}"

  # Run all checks
  if check_gpu_present; then
    check_gpu_health
    check_encoder
    check_gpu_processes
    check_driver_age
  fi
  check_ffmpeg
  check_cpu
  check_power_plan

  if $JSON_OUT; then
    print_json_report
    exit 0
  fi

  # Results
  generate_ffmpeg_templates
  print_summary

  if ! $REPORT_ONLY; then
    offer_fixes
  fi

  echo ""
  echo -e "${DIM}─── GPU Performance Doctor v${VERSION} — run with --help for options ───${RESET}"
  echo ""
}

main

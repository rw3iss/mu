@echo off
REM ═══════════════════════════════════════════════════════════════
REM  GPU Performance Doctor — Windows CMD Launcher
REM  Runs the PowerShell edition (no Git Bash required)
REM ═══════════════════════════════════════════════════════════════

echo.
echo   GPU Performance Doctor — Launching...
echo.

REM Try PowerShell 7+ first, then Windows PowerShell
where pwsh >nul 2>&1
if %ERRORLEVEL% equ 0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0gpu-doctor.ps1" %*
    goto :end
)

where powershell >nul 2>&1
if %ERRORLEVEL% equ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gpu-doctor.ps1" %*
    goto :end
)

echo   [ERROR] PowerShell not found.
echo   Please install PowerShell or run gpu-doctor.sh in Git Bash.
pause

:end

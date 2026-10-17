@echo off
setlocal
cd /d "%~dp0"
rem The execution-policy option applies only to this PowerShell process.
rem No system policy, administrator privileges, or global Node installation is changed.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap\start.ps1" %*
if errorlevel 1 (
  echo Could not start. See the error above, then retry.
  pause
  exit /b 1
)

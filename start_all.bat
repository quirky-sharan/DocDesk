@echo off
rem Starts DocDesk: API (with the AI assistant) and web app, then opens the browser.
rem The real work is in scripts\start.ps1 - batch files are too fragile for it.
title DocDesk launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo   DocDesk did not start. Read the message above.
  pause
  exit /b 1
)
echo   You can close this window.
ping -n 8 127.0.0.1 >nul

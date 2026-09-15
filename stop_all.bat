@echo off
rem Stops everything start_all.bat started.
title DocDesk - stopping
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
ping -n 4 127.0.0.1 >nul

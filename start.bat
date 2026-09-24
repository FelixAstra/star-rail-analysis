@echo off
rem ─────────────────────────────────────────────────────────────────────────────
rem  Star Rail Warp Analyzer - Windows launcher
rem  Double-click this file -> start local server -> open browser
rem  Close this console window (or press Ctrl-C) to stop the server.
rem
rem  All real logic lives in tools\launch.js (cross-platform, testable);
rem  this file only checks that Node.js exists and hands over to it.
rem  NOTE: keep this file ASCII-only and let .gitattributes enforce CRLF.
rem ─────────────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found.
  echo Install the LTS version from https://nodejs.org/ then run this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

node "%~dp0tools\launch.js"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%

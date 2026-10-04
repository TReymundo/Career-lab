@echo off
title Career Lab
cd /d "%~dp0"

echo.
echo   Starting Career Lab...
echo   Keep this window open while you use it. Close it to stop.
echo.

rem --- Node.js: install it automatically on a computer that does not have it yet. ---
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%PATH%;%ProgramFiles%\nodejs"
  ) else (
    echo   Career Lab needs Node.js, which is not installed here yet.
    echo   Installing it now with Windows' own installer - accept the prompt if one appears.
    echo.
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
      echo.
      echo   The automatic install did not work. Install Node.js "LTS" from https://nodejs.org
      echo   then double-click this file again.
      pause
      exit /b 1
    )
    set "PATH=%PATH%;%ProgramFiles%\nodejs"
  )
)

rem --- The app's own parts: downloaded once, the first time. ---
if not exist "node_modules" (
  echo   First run - installing Career Lab. This takes a minute or two.
  call npm install
  if errorlevel 1 (
    echo.
    echo   The install failed - check your internet connection and try again.
    pause
    exit /b 1
  )
)

rem Give the servers a moment to bind before the browser goes looking for them.
start "" cmd /c "timeout /t 6 >nul && start http://localhost:5273"

call npm run dev
pause

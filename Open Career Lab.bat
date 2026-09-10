@echo off
title Career Lab
cd /d "%~dp0"

echo.
echo   Starting Career Lab...
echo   Keep this window open while you use it. Close it to stop.
echo.

if not exist "node_modules" (
  echo   First run - installing. This takes a minute.
  call npm install
)

rem Give the servers a moment to bind before the browser goes looking for them.
start "" cmd /c "timeout /t 4 >nul && start http://localhost:5273"

call npm run dev
